-- MANUAL, ONE TIME. DO NOT source via Supabase migrations or GitHub Actions.
-- Owner explicitly authorized perpetual activation of JCO InmoDigital Global via ChatGPT.
-- This is operator-executed provisioning: audit actor_user_id remains NULL,
-- NEVER spoof an authenticated owner JWT or charge via Wompi.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $provision$
DECLARE
 target constant uuid := '97c570d3-200d-4ae7-af96-f22f69563e29';
 superadmin constant uuid := 'f738897b-46df-4c38-9887-5b20c0ff8946';
 lifetime uuid; current_terms uuid; permissions text[];
BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>102 OR
  (SELECT name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1)<>'manual_lifetime_owner_only' THEN
  RAISE EXCEPTION 'Expected safe, deployed v102 owner-only grant migration'; END IF;
 IF (SELECT production_enabled FROM public.billing_activation_settings) IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'Do not provision while Wompi live'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organizations
   WHERE id=target AND slug='jco-inmodigital-global' AND status='ACTIVE')
 THEN RAISE EXCEPTION 'Wrong personal agency'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=target FOR UPDATE;
 PERFORM 1 FROM public.organization_billing_access WHERE organization_id=target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing billing account'; END IF;
 PERFORM 1 FROM public.subscriptions WHERE organization_id=target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing subscription'; END IF;
 IF (SELECT count(*) FROM public.platform_admins
     WHERE active AND admin_level IN ('SUPER_ADMIN','PLATFORM_OWNER'))<>1
 OR NOT EXISTS(SELECT 1 FROM public.platform_admins
     WHERE user_id=superadmin AND active AND admin_level IN ('SUPER_ADMIN','PLATFORM_OWNER'))
 OR NOT EXISTS(SELECT 1 FROM public.organization_members m
    JOIN public.member_roles mr ON mr.organization_member_id=m.id
    JOIN public.roles r ON r.id=mr.role_id
    WHERE m.user_id=superadmin AND m.organization_id=target
      AND m.status='ACTIVE' AND r.key='ORGANIZATION_OWNER' AND r.organization_id=target AND r.active)
 THEN RAISE EXCEPTION 'Only verified sole platform owner may authorize'; END IF;
 SELECT id INTO lifetime FROM public.plans WHERE code='LIFETIME' AND active
 AND billing_cycle='ONE_TIME' AND max_users=25 AND max_properties=2000;
 IF lifetime IS NULL OR NOT jco_private.plan_capacity_fits(target,lifetime)
 THEN RAISE EXCEPTION 'Invalid perpetual limits'; END IF;
 IF EXISTS(SELECT 1 FROM public.payment_orders WHERE organization_id=target
 AND status='APPROVED' AND fulfillment_status='REVIEW_REQUIRED')
 THEN RAISE EXCEPTION 'An approved payment requires review'; END IF;
 IF EXISTS(SELECT 1 FROM public.subscriptions WHERE organization_id=target
 AND status='ACTIVE' AND current_period_end>now())
 THEN RAISE EXCEPTION 'Active paid plan requires contract review'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_licenses
    WHERE organization_id=target AND license_type='SAAS' AND status='ACTIVE')
 THEN RAISE EXCEPTION 'Current license must be active SAAS'; END IF;
 SELECT id INTO current_terms FROM public.license_terms_versions
 WHERE active ORDER BY effective_date DESC,created_at DESC LIMIT 1;
 IF current_terms IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.license_acceptances a
   JOIN public.organization_members m ON m.organization_id=a.organization_id AND
      m.user_id=a.accepted_by AND m.status='ACTIVE'
   JOIN public.member_roles mr ON mr.organization_member_id=m.id
   JOIN public.roles r ON r.id=mr.role_id AND r.organization_id=target AND r.active AND r.key='ORGANIZATION_OWNER'
   WHERE a.organization_id=target AND a.terms_version_id=current_terms
 ) THEN RAISE EXCEPTION 'No current verified owner-accepted terms'; END IF;
 SELECT array_agg(substr(feature_key,12) ORDER BY feature_key) INTO permissions
 FROM public.plan_features WHERE plan_id=lifetime AND enabled AND feature_key LIKE 'permission:%';
 IF coalesce(cardinality(permissions),0)=0
 THEN RAISE EXCEPTION 'Lifetime rights not configured'; END IF;

 UPDATE public.organization_billing_access
 SET requires_payment=true,is_test=false,manual_access_until=NULL,allowed_permissions=permissions,updated_at=now()
 WHERE organization_id=target;
 UPDATE public.subscriptions
 SET plan_id=lifetime,status='LIFETIME',billing_mode='LIFETIME',
 started_at=now(),current_period_start=now(),current_period_end=NULL,
 trial_ends_at=NULL,cancelled_at=NULL,updated_at=now() WHERE organization_id=target;
 UPDATE public.organization_licenses
 SET license_type='LIFETIME',status='ACTIVE',starts_at=now(),ends_at=NULL,
 operational_control_full=true,white_label_allowed=true,terms_version_id=current_terms,
 copyright_transferred=false,resale_allowed=false,sublicensing_allowed=false,
 redistribution_allowed=false,updated_at=now() WHERE organization_id=target;
 UPDATE public.organizations SET plan_id=lifetime,status='ACTIVE',updated_at=now()
 WHERE id=target;
 INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
 VALUES(target,NULL,'billing.owner_authorized_lifetime_provisioned','organization',target,
 jsonb_build_object('authorization','Owner explicitly requested in ChatGPT conversation 2026-11-07',
   'approved_platform_superadmin',superadmin,'executed_by','privileged deployment operator',
   'plan_id',lifetime,'no_wompi_charge',true,'license_scope','internal use 25 seats 2000 properties'));
 IF NOT jco_private.operational_access(target) OR NOT EXISTS(
 SELECT 1 FROM public.subscriptions s JOIN public.organization_licenses l ON l.organization_id=s.organization_id
 JOIN public.organization_billing_access b ON b.organization_id=s.organization_id
 WHERE s.organization_id=target AND s.status='LIFETIME' AND s.billing_mode='LIFETIME'
 AND s.current_period_end IS NULL AND l.license_type='LIFETIME' AND l.status='ACTIVE'
 AND l.ends_at IS NULL AND b.manual_access_until IS NULL AND b.requires_payment)
 THEN RAISE EXCEPTION 'Lifetime provision incomplete'; END IF;
END
$provision$;
COMMIT;
