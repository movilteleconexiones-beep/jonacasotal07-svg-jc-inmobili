-- Isolated PostgreSQL regression: TRIAL PRO -> paid BASIC, no external Wompi.
-- Run after the existing billing fixture and versioned Wompi migrations.
CREATE FUNCTION pg_temp.assert(ok boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
END $$;

INSERT INTO public.organizations(id,name,slug,status)
VALUES ('20000000-0000-0000-0000-000000000002','Trial buyer','trial-buyer','ACTIVE');

INSERT INTO public.organization_members(id,organization_id,user_id,status)
VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',
        '10000000-0000-0000-0000-000000000001','ACTIVE');

INSERT INTO public.roles(id,organization_id,key)
VALUES ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','ORGANIZATION_OWNER');
INSERT INTO public.member_roles VALUES ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
INSERT INTO public.role_permissions
SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.id='30000000-0000-0000-0000-000000000001';

INSERT INTO public.license_terms_versions(id,version,title,terms_markdown)
VALUES ('40000000-0000-0000-0000-000000000001','1','Fixture terms','TEST ONLY');

SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT public.billing_accept_terms('20000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000001','regression fixture');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
SELECT public.billing_admin_action('20000000-0000-0000-0000-000000000002','MARK_TEST','Isolated test only');
UPDATE public.billing_activation_settings
  SET sandbox_enabled=true,production_enabled=false,activation_mode='VERIFIED_PAYMENT';

-- Provisional PRO does not represent a paid commercial commitment.
INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,current_period_start,current_period_end)
VALUES ('20000000-0000-0000-0000-000000000002',
       (SELECT id FROM public.plans WHERE code='PRO'), 'TRIAL','SAAS_MONTHLY',
       now()-interval '1 day',now()+interval '5 days');

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT public.billing_create_order('20000000-0000-0000-0000-000000000002',
  (SELECT id FROM public.plans WHERE code='BASIC'),'sandbox',
  '50000000-0000-0000-0000-000000000006');
SELECT public.billing_create_order('20000000-0000-0000-0000-000000000002',
  (SELECT id FROM public.plans WHERE code='BASIC'),'sandbox',
  '50000000-0000-0000-0000-000000000006');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.payment_orders),
  'TRIAL checkout retry does not duplicate pending orders');

-- Tampered amount is rejected without granting access.
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT pg_temp.assert(
  public.process_verified_payment_event(
    (SELECT reference FROM public.payment_orders LIMIT 1),'tx-trial-wrong',1,'COP',
    'APPROVED','sandbox',repeat('a',64),repeat('b',64))='mismatch',
  'wrong amount rejected');
SELECT pg_temp.assert(
  (SELECT status='TRIAL' FROM public.subscriptions WHERE organization_id='20000000-0000-0000-0000-000000000002'),
  'no paid subscription before valid webhook');

-- The Edge handler verifies the Wompi signature and provider REST response.
-- This SQL test begins AFTER those checks, at the privileged atomic RPC.
SELECT pg_temp.assert(
  public.process_verified_payment_event(
    (SELECT reference FROM public.payment_orders LIMIT 1),'tx-trial-basic-verified',
    (SELECT amount_in_cents FROM public.payment_orders LIMIT 1),
    'COP','APPROVED','sandbox',repeat('c',64),repeat('d',64))='processed',
  'verified trial-to-paid webhook processed');
SELECT pg_temp.assert(
  (SELECT po.status='APPROVED' AND po.fulfillment_status='APPLIED'
    AND po.review_reason IS NULL FROM public.payment_orders po LIMIT 1),
  'payment applied without contract_review');
SELECT pg_temp.assert(
  (SELECT s.status='ACTIVE' AND p.code='BASIC' AND s.current_period_start >= now()-interval '1 minute'
    AND s.current_period_end BETWEEN now()+interval '1 month'-interval '1 minute'
                                 AND now()+interval '1 month'+interval '1 minute'
   FROM public.subscriptions s JOIN public.plans p ON p.id=s.plan_id
   WHERE s.organization_id='20000000-0000-0000-0000-000000000002'),
  'paid month starts now, without appending free trial days');
SELECT pg_temp.assert(
  (SELECT status='ACTIVE' AND license_type='SAAS' AND starts_at>=now()-interval '1 minute'
   FROM public.organization_licenses
   WHERE organization_id='20000000-0000-0000-0000-000000000002'),
  'SaaS license activated');
SELECT pg_temp.assert(
  (SELECT status='ACTIVE' FROM public.organizations
   WHERE id='20000000-0000-0000-0000-000000000002'),
  'tenant activated');
SELECT pg_temp.assert(
  public.process_verified_payment_event(
    (SELECT reference FROM public.payment_orders LIMIT 1),'tx-trial-basic-verified',
    (SELECT amount_in_cents FROM public.payment_orders LIMIT 1),
    'COP','APPROVED','sandbox',repeat('c',64),repeat('e',64))='duplicate',
  'duplicate event does not activate twice');
SELECT pg_temp.assert(
  (SELECT count(*)=1 FROM public.payment_events) AND
  (SELECT count(*)=1 FROM public.subscriptions WHERE organization_id='20000000-0000-0000-0000-000000000002'),
  'idempotent payment and subscription');

-- A paid active BASIC subscription must NOT silently change to PRO.
SELECT set_config('request.jwt.claim.role','authenticated',false);
DO $active_change$ BEGIN
  BEGIN
    PERFORM public.billing_create_order('20000000-0000-0000-0000-000000000002',
      (SELECT id FROM public.plans WHERE code='PRO'),'sandbox',gen_random_uuid());
    RAISE EXCEPTION 'FAIL: paid active plan switch accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Plan change requires administrative review%' THEN RAISE; END IF;
  END;
END $active_change$;
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.payment_orders),
  'no paid-plan switch order created');

-- An administratively suspended license must be blocked BEFORE checkout.
UPDATE public.organization_licenses SET status='SUSPENDED'
 WHERE organization_id='20000000-0000-0000-0000-000000000002';
DO $license_guard$ BEGIN
  BEGIN
    PERFORM public.billing_create_order('20000000-0000-0000-0000-000000000002',
      (SELECT id FROM public.plans WHERE code='BASIC'),'sandbox',gen_random_uuid());
    RAISE EXCEPTION 'FAIL: suspended license could start checkout';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%License requires administrative review%' THEN RAISE; END IF;
  END;
END $license_guard$;
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.payment_orders),
  'suspended license cannot create a paid order');
SELECT pg_temp.assert((SELECT NOT production_enabled FROM public.billing_activation_settings),
  'live charging remains disabled');

-- A previous APPROVED/REVIEW_REQUIRED payment must block a SECOND charge.
-- Fixture-only status transition: real reviews require audited reconciliation.
UPDATE public.organization_licenses SET status='ACTIVE'
 WHERE organization_id='20000000-0000-0000-0000-000000000002';
UPDATE public.payment_orders
 SET fulfillment_status='REVIEW_REQUIRED', review_reason='contract_review'
 WHERE organization_id='20000000-0000-0000-0000-000000000002' AND status='APPROVED';
DO $already_paid$ BEGIN
  BEGIN
    PERFORM public.billing_create_order('20000000-0000-0000-0000-000000000002',
      (SELECT id FROM public.plans WHERE code='BASIC'),'sandbox',gen_random_uuid());
    RAISE EXCEPTION 'FAIL: approved payment was charged twice';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Approved payment requires reconciliation%' THEN RAISE; END IF;
  END;
END $already_paid$;
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.payment_orders),
  'approved review requires reconciliation before another checkout');

-- Historical reconciliation regression: an APPROVED Wompi sandbox event
-- was stored but old code left it in REVIEW_REQUIRED during a PRO trial.
UPDATE public.subscriptions
   SET status='TRIAL', plan_id=(SELECT id FROM public.plans WHERE code='PRO'),
       current_period_start=now()-interval '1 day',
       current_period_end=now()+interval '5 days',
       trial_ends_at=now()+interval '5 days'
 WHERE organization_id='20000000-0000-0000-0000-000000000002';
UPDATE public.organizations
   SET plan_id=(SELECT id FROM public.plans WHERE code='PRO')
 WHERE id='20000000-0000-0000-0000-000000000002';
SELECT pg_temp.assert(
 (SELECT status='APPROVED' AND fulfillment_status='REVIEW_REQUIRED' AND review_reason='contract_review'
 FROM public.payment_orders), 'legacy approved order review fixture');

SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated',
      'jco_private.reconcile_verified_sandbox_trial_payment(uuid,text)','EXECUTE')
  AND NOT has_function_privilege('anon',
      'jco_private.reconcile_verified_sandbox_trial_payment(uuid,text)','EXECUTE')
  AND NOT has_function_privilege('service_role',
      'jco_private.reconcile_verified_sandbox_trial_payment(uuid,text)','EXECUTE'),
  'reconciliation is not available over public API or service role');

SELECT pg_temp.assert(
 jco_private.reconcile_verified_sandbox_trial_payment(
   (SELECT id FROM public.payment_orders LIMIT 1),
   'Authorized isolated test to reconcile a signed sandbox transaction') = 'applied',
 'signed prior sandbox payment is reconciled');
SELECT pg_temp.assert(
 jco_private.reconcile_verified_sandbox_trial_payment(
   (SELECT id FROM public.payment_orders LIMIT 1),
   'Authorized isolated test repeat must be idempotent') = 'already_applied',
 'repeat reconciliation is idempotent');
SELECT pg_temp.assert(
 (SELECT status='APPROVED' AND fulfillment_status='APPLIED' AND review_reason IS NULL
 FROM public.payment_orders) AND
 (SELECT s.status='ACTIVE' AND pl.code='BASIC'
  AND s.current_period_start=po.approved_at
  AND s.current_period_end=po.approved_at+interval '1 month'
  AND s.trial_ends_at IS NULL
  FROM public.subscriptions s JOIN public.plans pl ON pl.id=s.plan_id
  CROSS JOIN public.payment_orders po
  WHERE s.organization_id=po.organization_id),
 'reconciled BASIC subscription period starts at original approval time');
SELECT pg_temp.assert(
 (SELECT count(*)=1 FROM public.payment_events) AND
 (SELECT count(*)=1 FROM public.audit_log
  WHERE action='billing.sandbox_trial_reconciled')
 AND (SELECT count(*)=1 FROM public.subscriptions
   WHERE organization_id='20000000-0000-0000-0000-000000000002'),
 'reconciliation changes no original payment event or duplicate subscription');
