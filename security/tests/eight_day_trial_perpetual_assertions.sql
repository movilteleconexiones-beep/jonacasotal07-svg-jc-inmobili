-- Only PostgreSQL 17 synthetic database. Every assertion can abort CI; no production access.
CREATE FUNCTION pg_temp.assert_true(ok boolean, description text) RETURNS void
 LANGUAGE plpgsql AS $assert$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',description; END IF;
 END $assert$;

SELECT pg_temp.assert_true(NOT has_function_privilege('anon',
 'public.billing_start_eight_day_trial(uuid,uuid)','EXECUTE'),'anon cannot trigger trial');
SELECT pg_temp.assert_true(has_function_privilege('authenticated',
 'public.billing_start_eight_day_trial(uuid,uuid)','EXECUTE'),'authenticated must be allowed, server verifies owner');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated',
 'private.jco_trial_redemptions','INSERT'),'trial claims table has no direct insert grant');
SELECT pg_temp.assert_true((SELECT max_users=25 AND max_properties=2000 FROM public.plans WHERE code='LIFETIME'),
 'perpetual plan has bounded quota, not infinite seats');
SELECT pg_temp.assert_true((SELECT count(*)>0 FROM public.plan_features f
 JOIN public.plans p ON p.id=f.plan_id WHERE p.code='LIFETIME' AND f.enabled AND feature_key LIKE 'permission:%'),
 'lifetime must have entitlement keys');
-- Verified non-admin owner starts an eight-day trial, not a sandbox purchase.
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT public.billing_start_eight_day_trial('20000000-0000-0000-0000-000000000010',
  (SELECT id FROM public.plans WHERE code='PRO'));
SELECT pg_temp.assert_true((SELECT status='TRIAL' AND trial_ends_at=started_at+interval '8 days'
  AND current_period_end=trial_ends_at FROM public.subscriptions
  WHERE organization_id='20000000-0000-0000-0000-000000000010'), 'trial lasts exactly 8 days');
SELECT pg_temp.assert_true(jco_private.operational_access('20000000-0000-0000-0000-000000000010'),
 'trial allows temporarily authorized modules');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM private.jco_trial_redemptions),
 'one redemption persisted immutably');
DO $no_retrial$ BEGIN
  BEGIN
    PERFORM public.billing_start_eight_day_trial(
      '20000000-0000-0000-0000-000000000010',
      (SELECT id FROM public.plans WHERE code='BASIC'));
    RAISE EXCEPTION 'FAIL: repeated trial accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='FAIL: repeated trial accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.billing_start_eight_day_trial(
      '20000000-0000-0000-0000-000000000011',
      (SELECT id FROM public.plans WHERE code='BASIC'));
    RAISE EXCEPTION 'FAIL: one person received second trial on another org';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='FAIL: one person received second trial on another org' THEN RAISE; END IF;
  END;
END $no_retrial$;
-- Only temporary grant expires, never wipes the prospect's rows.
UPDATE public.organization_billing_access
  SET manual_access_until=now()-interval '1 second'
  WHERE organization_id='20000000-0000-0000-0000-000000000010';
SELECT pg_temp.assert_true(NOT jco_private.operational_access('20000000-0000-0000-0000-000000000010'),
 'expired trial rejects operational access');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.subscriptions
 WHERE organization_id='20000000-0000-0000-0000-000000000010'),
 'expiry never deletes customer subscriptions');
-- Restore fixture's current trial window, then run an actual simulated checkout
-- with the already tested Wompi SQL function, not a mocked status flip.
UPDATE public.organization_billing_access SET manual_access_until=now()+interval '1 day',is_test=true
 WHERE organization_id='20000000-0000-0000-0000-000000000010';
UPDATE public.billing_activation_settings SET sandbox_enabled=true,production_enabled=false;
SELECT public.billing_create_order(
  '20000000-0000-0000-0000-000000000010',
  (SELECT id FROM public.plans WHERE code='BASIC'),'sandbox',
  '70000000-0000-0000-0000-000000000010');
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT pg_temp.assert_true(public.process_verified_payment_event(
  (SELECT reference FROM public.payment_orders WHERE organization_id='20000000-0000-0000-0000-000000000010'),
  'signed-fixture-tx-001',(SELECT amount_in_cents FROM public.payment_orders WHERE organization_id='20000000-0000-0000-0000-000000000010'),
  'COP','APPROVED','sandbox',repeat('a',64),repeat('b',64))='processed',
  'valid signed sandbox payment passes existing Wompi processor');
SELECT pg_temp.assert_true((SELECT status='ACTIVE' AND trial_ends_at IS NULL
 AND current_period_start > now()-interval '3 minutes'
 AND current_period_end BETWEEN now()+interval '27 days' AND now()+interval '32 days'
 FROM public.subscriptions WHERE organization_id='20000000-0000-0000-0000-000000000010'),
 'paid plan replaces trial now without adding 8 days');
SELECT pg_temp.assert_true((SELECT manual_access_until IS NULL FROM public.organization_billing_access
 WHERE organization_id='20000000-0000-0000-0000-000000000010'),
 'paid entitlement clears temporary 8-day grant');
SELECT pg_temp.assert_true(public.process_verified_payment_event(
  (SELECT reference FROM public.payment_orders WHERE organization_id='20000000-0000-0000-0000-000000000010'),
  'signed-fixture-tx-001',(SELECT amount_in_cents FROM public.payment_orders WHERE organization_id='20000000-0000-0000-0000-000000000010'),
  'COP','APPROVED','sandbox',repeat('a',64),repeat('c',64))='duplicate',
  'redelivery cannot lengthen paid plan');

-- Manual perpetuity must be unavailable to an unrelated ordinary owner.
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
DO $denied$ BEGIN
  BEGIN
    PERFORM public.billing_admin_action(
      '20000000-0000-0000-0000-000000000012','GRANT_LIFETIME',
      'Synthetic unauthorised customer attempt',
      (SELECT id FROM public.plans WHERE code='LIFETIME'));
    RAISE EXCEPTION 'FAIL: tenant owner granted perpetual license';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $denied$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
SELECT public.billing_admin_action(
  '20000000-0000-0000-0000-000000000012','GRANT_LIFETIME',
  'Audited personal unlimited duration, limited seats',
  (SELECT id FROM public.plans WHERE code='LIFETIME'));
SELECT pg_temp.assert_true((SELECT status='LIFETIME' AND billing_mode='LIFETIME'
 AND current_period_end IS NULL AND trial_ends_at IS NULL FROM public.subscriptions
 WHERE organization_id='20000000-0000-0000-0000-000000000012'),
 'manual lifetime has no subscription expiration');
SELECT pg_temp.assert_true((SELECT license_type='LIFETIME' AND status='ACTIVE' AND ends_at IS NULL
 FROM public.organization_licenses WHERE organization_id='20000000-0000-0000-0000-000000000012'),
 'perpetual license cannot expire by monthly billing');
SELECT pg_temp.assert_true(jco_private.operational_access('20000000-0000-0000-0000-000000000012'),
 'lifetime operational gate permits authorized tenant');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.audit_log
 WHERE organization_id='20000000-0000-0000-0000-000000000012'
 AND action='billing.admin_grant_lifetime' AND actor_user_id='10000000-0000-0000-0000-000000000003'),
 'manual perpetual operation has SuperAdmin audit actor');
SELECT public.billing_admin_action(
  '20000000-0000-0000-0000-000000000012','SUSPEND',
  'Synthetic revoke of active infinite license',NULL);
SELECT pg_temp.assert_true(NOT jco_private.operational_access('20000000-0000-0000-0000-000000000012'),
 'suspension supersedes perpetual duration');
SELECT pg_temp.assert_true((SELECT NOT production_enabled FROM public.billing_activation_settings),
 'no Wompi production activation');
