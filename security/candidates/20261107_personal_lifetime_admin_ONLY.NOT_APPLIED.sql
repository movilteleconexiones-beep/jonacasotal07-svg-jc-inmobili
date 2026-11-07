-- #254: Only designated SuperAdmin may grant audited LIFETIME; no checkout, trial or Wompi changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $preflight$
BEGIN
 IF to_regprocedure('jco_private.plan_capacity_fits(uuid,uuid)') IS NULL OR
 position('jco_private.plan_capacity_fits(target_org,target_plan)' IN
 pg_get_functiondef('public.billing_admin_action(uuid,text,text,uuid)'::regprocedure))=0 OR
 position('jco_private.plan_capacity_fits(org.id,payment.plan_id)' IN
 pg_get_functiondef('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)'::regprocedure))=0
 THEN RAISE EXCEPTION 'Missing v101 capacity guard'; END IF;
END $preflight$;
DO $catalog$
DECLARE lifetime uuid; professional uuid;
BEGIN
  SELECT id INTO lifetime FROM public.plans WHERE code='LIFETIME' AND billing_cycle='ONE_TIME' AND active;
  SELECT id INTO professional FROM public.plans WHERE code='PRO' AND billing_cycle='MONTHLY' AND active;
  IF lifetime IS NULL OR professional IS NULL THEN
    RAISE EXCEPTION 'Lifetime or professional plan is absent'; END IF;
  -- This draft defines bounded LIFETIME access as PRO's exact permission set.
  -- An existing, partially configured catalog MUST NOT silently retain more
  -- permissions, stale disabled states, or legacy limits.
  UPDATE public.plans SET max_users=25,max_properties=2000
    WHERE id=lifetime;
  INSERT INTO public.plan_features(plan_id,feature_key,enabled,feature_limit)
    SELECT lifetime,f.feature_key,f.enabled,f.feature_limit
    FROM public.plan_features f
    WHERE f.plan_id=professional AND f.feature_key LIKE 'permission:%'
    ON CONFLICT(plan_id,feature_key) DO UPDATE SET
      enabled=EXCLUDED.enabled,
      feature_limit=EXCLUDED.feature_limit;
  -- A lifetime permission missing from PRO cannot remain independently enabled.
  UPDATE public.plan_features stale SET enabled=false
    WHERE stale.plan_id=lifetime AND stale.feature_key LIKE 'permission:%'
    AND NOT EXISTS (
      SELECT 1 FROM public.plan_features source
      WHERE source.plan_id=professional AND source.feature_key=stale.feature_key
        AND source.enabled=true
    );
END $catalog$;
CREATE OR REPLACE FUNCTION public.billing_admin_action(target_org uuid, action text, reason text, target_plan uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE plan public.plans%ROWTYPE; end_at timestamptz; keys text[]; terms_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  IF reason IS NULL OR length(trim(reason))<10 OR length(reason)>1000 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  PERFORM 1 FROM public.organizations WHERE id=target_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found'; END IF;
  IF action='SUSPEND' THEN
    UPDATE public.organizations SET status='SUSPENDED',updated_at=now() WHERE id=target_org;
  ELSIF action='MARK_TEST' THEN
    IF EXISTS(SELECT 1 FROM public.organization_billing_access WHERE organization_id=target_org AND
      (NOT requires_payment OR manual_access_until>now())) OR EXISTS(SELECT 1 FROM public.subscriptions
        WHERE organization_id=target_org AND status='ACTIVE') THEN RAISE EXCEPTION 'Only unactivated tenants can become test tenants'; END IF;
    UPDATE public.organization_billing_access SET is_test=true,updated_at=now() WHERE organization_id=target_org;
  ELSIF action='APPROVE' THEN
    SELECT * INTO plan FROM public.plans WHERE id=target_plan AND active AND billing_cycle IN ('MONTHLY','ANNUAL');
    IF NOT FOUND THEN RAISE EXCEPTION 'Choose an available monthly or annual plan'; END IF;
    IF EXISTS(SELECT 1 FROM public.organization_licenses WHERE organization_id=target_org AND license_type<>'SAAS')
      THEN RAISE EXCEPTION 'Dedicated licenses require a separate contract'; END IF;
    IF NOT jco_private.plan_capacity_fits(target_org,target_plan) THEN RAISE EXCEPTION 'Plan capacity exceeded' USING ERRCODE='23514'; END IF;
    SELECT array_agg(substr(feature_key,12)) INTO keys FROM public.plan_features
      WHERE plan_id=target_plan AND enabled AND feature_key LIKE 'permission:%';
    IF coalesce(cardinality(keys),0)=0 THEN RAISE EXCEPTION 'Plan permissions not configured'; END IF;
    end_at:=now()+CASE WHEN plan.billing_cycle='MONTHLY' THEN interval '1 month' ELSE interval '1 year' END;
    UPDATE public.organization_billing_access SET manual_access_until=end_at,allowed_permissions=keys,
      updated_at=now() WHERE organization_id=target_org;
    UPDATE public.organizations SET status='ACTIVE',plan_id=target_plan,updated_at=now() WHERE id=target_org;
  ELSIF action='GRANT_LIFETIME' THEN
    -- Only the named platform owner, never ordinary estate owners or another admin.
    IF auth.uid() IS DISTINCT FROM 'f738897b-46df-4c38-9887-5b20c0ff8946'::uuid
       OR NOT EXISTS (SELECT 1 FROM public.platform_admins pa
         WHERE pa.user_id=auth.uid() AND pa.active AND pa.admin_level IN ('SUPER_ADMIN','PLATFORM_OWNER'))
    THEN RAISE EXCEPTION 'Only the designated platform SuperAdmin can grant perpetual licenses' USING ERRCODE='42501'; END IF;

    -- A perpetual term is not a tool to override a suspension or rewrite
    -- the beginning of an already active lifetime license. Both are separate
    -- audited decisions; a suspended tenant requires explicit review.
    IF EXISTS(SELECT 1 FROM public.organizations
       WHERE id=target_org AND status='SUSPENDED') THEN
      RAISE EXCEPTION 'Suspended organization requires separate reactivation'
        USING ERRCODE='42501'; END IF;
    IF EXISTS(SELECT 1 FROM public.organization_licenses
       WHERE organization_id=target_org AND license_type='LIFETIME'
         AND status='ACTIVE' AND ends_at IS NULL) THEN
      RAISE EXCEPTION 'Perpetual license already active'; END IF;
    SELECT * INTO plan FROM public.plans
      WHERE id=target_plan AND active AND code='LIFETIME' AND billing_cycle='ONE_TIME' FOR SHARE;
    IF NOT FOUND OR plan.max_users IS NULL OR plan.max_properties IS NULL
      OR plan.max_users<1 OR plan.max_properties<1 THEN
      RAISE EXCEPTION 'Perpetual license limits and plan catalog require configuration'; END IF;
    IF EXISTS(SELECT 1 FROM public.payment_orders
      WHERE organization_id=target_org AND status='APPROVED'
        AND fulfillment_status='REVIEW_REQUIRED') THEN
      RAISE EXCEPTION 'Verified payment needs review before perpetual authorization'; END IF;
    IF EXISTS(SELECT 1 FROM public.subscriptions
      WHERE organization_id=target_org AND status='ACTIVE' AND current_period_end>now()) THEN
      RAISE EXCEPTION 'Active paid commercial period requires separate contract review'; END IF;
    IF EXISTS(SELECT 1 FROM public.organization_licenses
      WHERE organization_id=target_org AND license_type NOT IN ('SAAS','LIFETIME')) THEN
      RAISE EXCEPTION 'Special license requires separate contract review'; END IF;
    SELECT array_agg(substr(feature_key,12) ORDER BY feature_key) INTO keys
      FROM public.plan_features WHERE plan_id=target_plan
        AND enabled AND feature_key LIKE 'permission:%';
    IF coalesce(cardinality(keys),0)=0 THEN
      RAISE EXCEPTION 'Perpetual plan permissions not configured'; END IF;
    -- Perpetuity requires the CURRENT terms, accepted by an active owner
    -- of this exact agency. A historical receipt or another member's consent
    -- cannot authorize a non-expiring software entitlement.
    SELECT id INTO terms_id FROM public.license_terms_versions WHERE active
      ORDER BY effective_date DESC,created_at DESC LIMIT 1;
    IF terms_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.license_acceptances a
      JOIN public.organization_members m ON m.organization_id=a.organization_id
        AND m.user_id=a.accepted_by AND m.status='ACTIVE'
      JOIN public.member_roles mr ON mr.organization_member_id=m.id
      JOIN public.roles r ON r.id=mr.role_id AND r.organization_id=m.organization_id
        AND r.key='ORGANIZATION_OWNER' AND r.active
      WHERE a.organization_id=target_org AND a.terms_version_id=terms_id
    ) THEN
      RAISE EXCEPTION 'Current terms must be accepted by an active organization owner'; END IF;
    IF NOT jco_private.plan_capacity_fits(target_org,target_plan) THEN
      RAISE EXCEPTION 'Perpetual plan capacity exceeded'; END IF;
    UPDATE public.organization_billing_access SET requires_payment=true, is_test=false,
      manual_access_until=NULL,allowed_permissions=keys,updated_at=now()
      WHERE organization_id=target_org;
    IF NOT FOUND THEN RAISE EXCEPTION 'Billing account unavailable'; END IF;
    INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,
      started_at,current_period_start,current_period_end,trial_ends_at)
    VALUES(target_org,target_plan,'LIFETIME','LIFETIME',now(),now(),NULL,NULL)
    ON CONFLICT(organization_id) DO UPDATE SET
      plan_id=excluded.plan_id,status='LIFETIME',billing_mode='LIFETIME',
      started_at=excluded.started_at,current_period_start=excluded.current_period_start,
      current_period_end=NULL,trial_ends_at=NULL,cancelled_at=NULL,updated_at=now();
    INSERT INTO public.organization_licenses(organization_id,license_type,status,starts_at,ends_at)
    VALUES(target_org,'LIFETIME','ACTIVE',now(),NULL)
    ON CONFLICT(organization_id) DO UPDATE SET
      license_type='LIFETIME',status='ACTIVE',starts_at=excluded.starts_at,
      ends_at=NULL,operational_control_full=true,white_label_allowed=true,
      copyright_transferred=false,resale_allowed=false,sublicensing_allowed=false,
      redistribution_allowed=false,updated_at=now();
    UPDATE public.organizations SET status='ACTIVE',plan_id=target_plan,updated_at=now()
      WHERE id=target_org;
  ELSE RAISE EXCEPTION 'Unsupported administrative action'; END IF;
  INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES(target_org,auth.uid(),'billing.admin_'||lower(action),'organization',target_org,
      jsonb_build_object('reason',trim(reason),'plan_id',target_plan));
END;
$function$;

CREATE OR REPLACE FUNCTION jco_private.operational_access(target_org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations o
    JOIN public.organization_billing_access b ON b.organization_id=o.id
    WHERE o.id=target_org AND o.status='ACTIVE' AND (
      NOT b.requires_payment OR b.manual_access_until > now() OR EXISTS (
        SELECT 1 FROM public.subscriptions s
        JOIN public.organization_licenses l ON l.organization_id=s.organization_id
        WHERE s.organization_id=o.id AND s.status='ACTIVE'
          AND s.current_period_start <= now() AND s.current_period_end > now()
          AND l.license_type='SAAS' AND l.status='ACTIVE'
          AND l.starts_at <= now() AND l.ends_at > now()) OR EXISTS (
        SELECT 1 FROM public.subscriptions s
        JOIN public.organization_licenses l ON l.organization_id=s.organization_id
        WHERE s.organization_id=o.id AND s.status='LIFETIME'
          AND s.billing_mode='LIFETIME' AND s.current_period_end IS NULL
          AND l.license_type='LIFETIME' AND l.status='ACTIVE'
          AND l.starts_at <= now() AND l.ends_at IS NULL
      )));
$function$;
DO $postflight$
BEGIN
 IF position('jco_private.plan_capacity_fits(target_org,target_plan)' IN pg_get_functiondef('public.billing_admin_action(uuid,text,text,uuid)'::regprocedure))=0
 OR position('jco_private.plan_capacity_fits(org.id,payment.plan_id)' IN pg_get_functiondef('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)'::regprocedure))=0
 OR position('jco_private.plan_capacity_fits(target_org,target_plan_id)' IN pg_get_functiondef('public.platform_set_subscription(uuid,text,text,text)'::regprocedure))=0
 THEN RAISE EXCEPTION 'Billing capacity guard regression'; END IF;
 IF has_function_privilege('anon','public.billing_admin_action(uuid,text,text,uuid)','EXECUTE') OR
 NOT has_function_privilege('authenticated','public.billing_admin_action(uuid,text,text,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Billing admin RPC privilege regression'; END IF;
 IF (SELECT (max_users,max_properties) IS DISTINCT FROM (25,2000) FROM public.plans WHERE code='LIFETIME')
 THEN RAISE EXCEPTION 'Lifetime seat/property limit mismatch'; END IF;
END $postflight$;
NOTIFY pgrst,'reload schema';
COMMIT;
