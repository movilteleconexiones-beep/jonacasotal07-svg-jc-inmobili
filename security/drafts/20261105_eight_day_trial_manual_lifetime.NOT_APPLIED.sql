-- DRAFT, NOT APPLIED. #104 MIGRATION GATE IS NO-GO. PostgreSQL 17 CI only.
-- Commercial release: 8 days single-use per verified owner, paid immediately on verified Wompi;
-- SuperAdmin may grant audited perpetual access without a payment and without a false expiration.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
-- Lifetime is a distinct TERM, never unlimited USERS. Fix its explicit contract:
-- PRO entitlement equivalence until an independently signed lifetime tariff replaces it.
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


CREATE TABLE IF NOT EXISTS private.jco_trial_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  CHECK (ends_at = started_at + interval '8 days')
);
ALTER TABLE private.jco_trial_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.jco_trial_redemptions FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.billing_start_eight_day_trial(
  target_org uuid,target_plan uuid
) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $trial$
DECLARE
  actor uuid := auth.uid();
  plan public.plans%ROWTYPE;
  org public.organizations%ROWTYPE;
  account public.organization_billing_access%ROWTYPE;
  trial_start timestamptz := now();
  trial_end timestamptz := trial_start + interval '8 days';
  keys text[];
  terms_id uuid;
BEGIN
  IF actor IS NULL OR target_org IS NULL OR target_plan IS NULL THEN
    RAISE EXCEPTION 'Verified organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO org FROM public.organizations WHERE id=target_org FOR UPDATE;
  IF org.id IS NULL OR org.status<>'INACTIVE' OR public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only an unactivated customer organization can start a trial' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL)
    OR NOT EXISTS(SELECT 1 FROM public.organization_members m
      JOIN public.member_roles mr ON mr.organization_member_id=m.id
      JOIN public.roles r ON r.id=mr.role_id AND r.organization_id=m.organization_id
      WHERE m.organization_id=target_org AND m.user_id=actor AND m.status='ACTIVE'
        AND r.active AND r.key='ORGANIZATION_OWNER')
    OR EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=actor AND active) THEN
    RAISE EXCEPTION 'Verified organization owner required' USING ERRCODE='42501'; END IF;
  SELECT * INTO account FROM public.organization_billing_access WHERE organization_id=target_org FOR UPDATE;
  IF account.organization_id IS NULL OR account.is_test OR NOT account.requires_payment
    OR account.manual_access_until IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.subscriptions WHERE organization_id=target_org)
    OR EXISTS(SELECT 1 FROM public.payment_orders WHERE organization_id=target_org AND status='APPROVED')
    OR EXISTS(SELECT 1 FROM private.jco_trial_redemptions
      WHERE organization_id=target_org OR owner_user_id=actor)
    THEN RAISE EXCEPTION 'Trial already used or commercial account exists'; END IF;
  SELECT * INTO plan FROM public.plans WHERE id=target_plan AND active
    AND code IN ('BASIC','PRO') AND billing_cycle='MONTHLY'
    AND currency='COP' FOR SHARE;
  IF plan.id IS NULL THEN RAISE EXCEPTION 'Choose an eligible basic or professional plan'; END IF;
  IF (plan.max_users IS NOT NULL AND
      (SELECT count(*) FROM public.organization_members WHERE organization_id=target_org AND status='ACTIVE')>plan.max_users)
    OR (plan.max_properties IS NOT NULL AND
      (SELECT count(*) FROM public.properties WHERE organization_id=target_org)>plan.max_properties)
    THEN RAISE EXCEPTION 'Plan capacity exceeded'; END IF;
  SELECT id INTO terms_id FROM public.license_terms_versions WHERE active
    ORDER BY effective_date DESC,created_at DESC LIMIT 1;
  IF terms_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.license_acceptances
      WHERE organization_id=target_org AND terms_version_id=terms_id AND accepted_by=actor)
    THEN RAISE EXCEPTION 'Accept current license terms first'; END IF;
  SELECT array_agg(substr(feature_key,12) ORDER BY feature_key) INTO keys
    FROM public.plan_features WHERE plan_id=target_plan AND enabled AND feature_key LIKE 'permission:%';
  IF coalesce(cardinality(keys),0)=0 THEN RAISE EXCEPTION 'Trial plan permissions unavailable'; END IF;
  INSERT INTO private.jco_trial_redemptions(organization_id,owner_user_id,plan_id,started_at,ends_at)
    VALUES(target_org,actor,target_plan,trial_start,trial_end);
  UPDATE public.organization_billing_access
    SET manual_access_until=trial_end,allowed_permissions=keys,
      requires_payment=true,is_test=false,updated_at=now()
    WHERE organization_id=target_org;
  INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,
    started_at,current_period_start,current_period_end,trial_ends_at)
    VALUES(target_org,target_plan,'TRIAL','SAAS_MONTHLY',trial_start,trial_start,trial_end,trial_end);
  INSERT INTO public.organization_licenses(organization_id,license_type,status,starts_at,ends_at)
    VALUES(target_org,'SAAS','ACTIVE',trial_start,trial_end)
    ON CONFLICT (organization_id) DO UPDATE SET
      license_type='SAAS',status='ACTIVE',starts_at=excluded.starts_at,
      ends_at=excluded.ends_at,updated_at=now();
  UPDATE public.organizations SET status='ACTIVE',plan_id=target_plan,updated_at=now()
    WHERE id=target_org;
  INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES(target_org,actor,'billing.eight_day_trial_started','organization',target_org,
      jsonb_build_object('plan_id',target_plan,'ends_at',trial_end,'payment_received',false));
  RETURN trial_end;
END;
$trial$;
REVOKE ALL ON FUNCTION public.billing_start_eight_day_trial(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.billing_start_eight_day_trial(uuid,uuid) TO authenticated;

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
    SELECT array_agg(substr(feature_key,12)) INTO keys FROM public.plan_features
      WHERE plan_id=target_plan AND enabled AND feature_key LIKE 'permission:%';
    IF coalesce(cardinality(keys),0)=0 THEN RAISE EXCEPTION 'Plan permissions not configured'; END IF;
    end_at:=now()+CASE WHEN plan.billing_cycle='MONTHLY' THEN interval '1 month' ELSE interval '1 year' END;
    UPDATE public.organization_billing_access SET manual_access_until=end_at,allowed_permissions=keys,
      updated_at=now() WHERE organization_id=target_org;
    UPDATE public.organizations SET status='ACTIVE',plan_id=target_plan,updated_at=now() WHERE id=target_org;
  ELSIF action='GRANT_LIFETIME' THEN
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
    IF (SELECT count(*) FROM public.organization_members
          WHERE organization_id=target_org AND status='ACTIVE') > plan.max_users
       OR (SELECT count(*) FROM public.properties
          WHERE organization_id=target_org) > plan.max_properties THEN
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
      ends_at=NULL,updated_at=now();
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


CREATE OR REPLACE FUNCTION public.process_verified_payment_event(p_reference text, p_transaction_id text, p_amount_in_cents bigint, p_currency text, p_status text, p_environment text, p_event_id text, p_payload_sha256 text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE payment public.payment_orders%ROWTYPE; org public.organizations%ROWTYPE;
  account public.organization_billing_access%ROWTYPE; existing public.subscriptions%ROWTYPE;
  settings public.billing_activation_settings%ROWTYPE; start_at timestamptz; end_at timestamptz;
  reason text; prior_event public.payment_events%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('APPROVED','DECLINED','VOIDED','ERROR')
    OR p_event_id IS NULL OR p_event_id !~ '^[a-f0-9]{64}$'
    OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
    OR nullif(p_transaction_id,'') IS NULL THEN RETURN 'mismatch'; END IF;
  SELECT * INTO payment FROM public.payment_orders WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF payment.environment IS DISTINCT FROM p_environment OR payment.amount_in_cents IS DISTINCT FROM p_amount_in_cents
    OR payment.currency IS DISTINCT FROM p_currency OR (payment.provider_transaction_id IS NOT NULL
      AND payment.provider_transaction_id<>p_transaction_id) THEN RETURN 'mismatch'; END IF;
  SELECT * INTO prior_event FROM public.payment_events WHERE provider='WOMPI' AND provider_event_id=p_event_id;
  IF FOUND THEN
    IF prior_event.payment_order_id=payment.id AND prior_event.provider_transaction_id=p_transaction_id
      AND prior_event.reported_status=p_status THEN RETURN 'duplicate'; END IF;
    RETURN 'conflict';
  END IF;
  -- Approved payments are immutable. Reversal events go to reconciliation.
  IF payment.status<>'PENDING' THEN RETURN 'conflict'; END IF;
  SELECT * INTO org FROM public.organizations WHERE id=payment.organization_id FOR UPDATE;
  SELECT * INTO account FROM public.organization_billing_access WHERE organization_id=org.id;
  SELECT * INTO settings FROM public.billing_activation_settings WHERE id=true;
  IF p_status='APPROVED' THEN
    SELECT * INTO existing FROM public.subscriptions WHERE organization_id=org.id FOR UPDATE;
    reason:=CASE
      WHEN payment.expires_at<=now() THEN 'expired_order'
      WHEN org.status NOT IN ('ACTIVE','INACTIVE','TRIAL') THEN 'organization_inactive'
      WHEN p_environment='sandbox' AND (NOT settings.sandbox_enabled OR NOT account.is_test) THEN 'sandbox_isolation'
      WHEN p_environment='production' AND (NOT settings.production_enabled OR account.is_test) THEN 'production_disabled'
      WHEN settings.activation_mode='MANUAL' THEN 'manual_approval'
      WHEN existing.id IS NOT NULL AND (existing.billing_mode NOT IN ('SAAS_MONTHLY','SAAS_ANNUAL')
        OR existing.status NOT IN ('TRIAL','ACTIVE')
        OR (existing.status='ACTIVE' AND existing.current_period_end>now() AND existing.plan_id IS DISTINCT FROM payment.plan_id)) THEN 'contract_review'
      WHEN EXISTS(SELECT 1 FROM public.organization_licenses WHERE organization_id=org.id
        AND (license_type<>'SAAS' OR status IN ('SUSPENDED','CANCELLED','TERMINATED'))) THEN 'license_review'
      ELSE NULL END;
    IF reason IS NULL THEN
      start_at:=CASE WHEN existing.status='ACTIVE' AND existing.current_period_end>now()
        THEN existing.current_period_start ELSE now() END;
      -- A trial never lengthens a newly purchased paid period.
      end_at:=greatest(now(), CASE WHEN existing.status='ACTIVE' THEN existing.current_period_end ELSE now() END)+
        CASE WHEN payment.billing_mode='SAAS_MONTHLY' THEN interval '1 month' ELSE interval '1 year' END;
    END IF;
  END IF;
  -- A verified payment is recorded even if its fulfillment needs review.
  INSERT INTO public.payment_events(payment_order_id,provider_event_id,provider_transaction_id,
    reported_status,payload_sha256) VALUES(payment.id,p_event_id,p_transaction_id,p_status,p_payload_sha256);
  UPDATE public.payment_orders SET status=p_status,provider_transaction_id=p_transaction_id,
    approved_at=CASE WHEN p_status='APPROVED' THEN now() END,
    fulfillment_status=CASE WHEN p_status<>'APPROVED' THEN 'NO_ACCESS' WHEN reason IS NULL THEN 'APPLIED' ELSE 'REVIEW_REQUIRED' END,
    review_reason=reason,updated_at=now() WHERE id=payment.id;
  IF p_status='APPROVED' AND reason IS NULL THEN
    INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,current_period_start,current_period_end)
      VALUES(org.id,payment.plan_id,'ACTIVE',payment.billing_mode,start_at,end_at)
      ON CONFLICT(organization_id) DO UPDATE SET plan_id=excluded.plan_id,status='ACTIVE',billing_mode=excluded.billing_mode,
        current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
        started_at=excluded.current_period_start,trial_ends_at=NULL,
        cancelled_at=NULL,updated_at=now();
    INSERT INTO public.organization_licenses(organization_id,license_type,status,starts_at,ends_at)
      VALUES(org.id,'SAAS','ACTIVE',start_at,end_at) ON CONFLICT(organization_id) DO UPDATE SET
        status='ACTIVE',starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=now();
    UPDATE public.organization_billing_access SET requires_payment=true,allowed_permissions=payment.permission_keys,
      manual_access_until=NULL,updated_at=now() WHERE organization_id=org.id;
    UPDATE public.organizations SET status='ACTIVE',plan_id=payment.plan_id,updated_at=now() WHERE id=org.id;
    INSERT INTO public.audit_log(organization_id,action,entity_type,entity_id,metadata)
      VALUES(org.id,'billing.payment_activated','payment_order',payment.id,
        jsonb_build_object('plan_id',payment.plan_id,'environment',p_environment,'period_end',end_at));
  END IF;
  RETURN 'processed';
END;
$function$;


-- Existing trial authorization was revoked: keep it denied to anon/authenticated.
-- New self-service entry point is separate, scoped, non-repeatable and audited.
NOTIFY pgrst,'reload schema';
COMMIT;
