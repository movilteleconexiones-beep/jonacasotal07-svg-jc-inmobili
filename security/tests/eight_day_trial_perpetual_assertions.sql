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
-- The draft MUST repair deliberately corrupted pre-existing lifetime catalog.
-- Check enabled permission and numeric feature_limit parity in BOTH directions.
SELECT pg_temp.assert_true(NOT EXISTS (
  (SELECT f.feature_key,f.feature_limit FROM public.plan_features f
   JOIN public.plans p ON p.id=f.plan_id
   WHERE p.code='PRO' AND f.enabled AND f.feature_key LIKE 'permission:%'
   EXCEPT
   SELECT f.feature_key,f.feature_limit FROM public.plan_features f
   JOIN public.plans p ON p.id=f.plan_id
   WHERE p.code='LIFETIME' AND f.enabled AND f.feature_key LIKE 'permission:%')
  UNION ALL
  (SELECT f.feature_key,f.feature_limit FROM public.plan_features f
   JOIN public.plans p ON p.id=f.plan_id
   WHERE p.code='LIFETIME' AND f.enabled AND f.feature_key LIKE 'permission:%'
   EXCEPT
   SELECT f.feature_key,f.feature_limit FROM public.plan_features f
   JOIN public.plans p ON p.id=f.plan_id
   WHERE p.code='PRO' AND f.enabled AND f.feature_key LIKE 'permission:%')
), 'perpetual plan must have exact PRO enabled permission and limit parity');
SELECT pg_temp.assert_true(NOT EXISTS (
  SELECT 1 FROM public.plan_features f JOIN public.plans p ON p.id=f.plan_id
  WHERE p.code='LIFETIME' AND f.feature_key='permission:unapproved_perpetual_export'
    AND f.enabled
), 'extra lifetime-only permission cannot survive catalog synchronization');
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
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'Only an unactivated customer organization can start a trial'
      OR SQLSTATE <> '42501' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.billing_start_eight_day_trial(
      '20000000-0000-0000-0000-000000000011',
      (SELECT id FROM public.plans WHERE code='BASIC'));
    RAISE EXCEPTION 'FAIL: one person received second trial on another org';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'Trial already used or commercial account exists' THEN RAISE; END IF;
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

-- A new customer that purchases directly NEVER receives or consumes trial days.
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
UPDATE public.organization_billing_access SET is_test=true
  WHERE organization_id='20000000-0000-0000-0000-000000000011';
SELECT public.billing_create_order(
  '20000000-0000-0000-0000-000000000011',
  (SELECT id FROM public.plans WHERE code='BASIC'),'sandbox',
  '70000000-0000-0000-0000-000000000011');
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT pg_temp.assert_true(public.process_verified_payment_event(
  (SELECT reference FROM public.payment_orders WHERE organization_id='20000000-0000-0000-0000-000000000011'),
  'signed-fixture-tx-direct-002',
  (SELECT amount_in_cents FROM public.payment_orders WHERE organization_id='20000000-0000-0000-0000-000000000011'),
  'COP','APPROVED','sandbox',repeat('d',64),repeat('e',64))='processed',
  'direct payment is verified and processed without activating any trial');
SELECT pg_temp.assert_true((SELECT status='ACTIVE' AND trial_ends_at IS NULL
    AND current_period_start > now()-interval '3 minutes'
    AND current_period_end > current_period_start+interval '27 days'
    FROM public.subscriptions WHERE organization_id='20000000-0000-0000-0000-000000000011'),
    'direct paid plan starts immediately and never adds 8 trial days');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM private.jco_trial_redemptions
    WHERE organization_id='20000000-0000-0000-0000-000000000011'),
    'direct checkout does not create or consume a free trial');

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
-- Negative gate: do NOT accept an unrelated person's signature or an old
-- policy version when granting an irrevocable lifetime entitlement.
INSERT INTO public.license_terms_versions
 (id,version,title,terms_markdown,active,effective_date,created_at)
VALUES ('50000000-0000-0000-0000-000000000011','8day-v2','Current fixture terms',
 'CURRENT FIXTURE TERMS',true,current_date,now()+interval '1 minute');
INSERT INTO public.license_acceptances
 (organization_id,organization_license_id,terms_version_id,accepted_by,terms_snapshot,acceptance_user_agent)
SELECT l.organization_id,l.id,'50000000-0000-0000-0000-000000000011'::uuid,
 '10000000-0000-0000-0000-000000000003'::uuid,'WRONG SIGNER','CI ONLY'
FROM public.organization_licenses l
WHERE l.organization_id='20000000-0000-0000-0000-000000000012';
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
DO $terms_block$ BEGIN
  BEGIN
    PERFORM public.billing_admin_action(
     '20000000-0000-0000-0000-000000000012','GRANT_LIFETIME',
     'Reject outdated owner acceptance and unrelated actor',
     (SELECT id FROM public.plans WHERE code='LIFETIME'));
    RAISE EXCEPTION 'FAIL: old/non-owner terms accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'Current terms must be accepted by an active organization owner' THEN RAISE; END IF;
  END;
END $terms_block$;
INSERT INTO public.license_acceptances
 (organization_id,organization_license_id,terms_version_id,accepted_by,terms_snapshot,acceptance_user_agent)
SELECT l.organization_id,l.id,'50000000-0000-0000-0000-000000000011'::uuid,
 '10000000-0000-0000-0000-000000000002'::uuid,'CURRENT FIXTURE TERMS','CI ONLY'
FROM public.organization_licenses l
WHERE l.organization_id='20000000-0000-0000-0000-000000000012';

-- Exceed the real seat count, even though the catalog itself is configured.
INSERT INTO public.organization_members(id,organization_id,user_id,status)
VALUES ('30000000-0000-0000-0000-000000000013',
 '20000000-0000-0000-0000-000000000012',
 '10000000-0000-0000-0000-000000000001','ACTIVE');
UPDATE public.plans SET max_users=1 WHERE code='LIFETIME';
DO $seats_block$ BEGIN
  BEGIN
    PERFORM public.billing_admin_action(
     '20000000-0000-0000-0000-000000000012','GRANT_LIFETIME',
     'Reject two active members with one licensed seat',
     (SELECT id FROM public.plans WHERE code='LIFETIME'));
    RAISE EXCEPTION 'FAIL: over-seat perpetual grant accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'Perpetual plan capacity exceeded' THEN RAISE; END IF;
  END;
END $seats_block$;
UPDATE public.plans SET max_users=25 WHERE code='LIFETIME';
DELETE FROM public.organization_members
 WHERE id='30000000-0000-0000-0000-000000000013';

-- The real property count must be checked independently of staff quota.
INSERT INTO public.properties(id,organization_id,title) VALUES
 ('60000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000012','Synthetic property A'),
 ('60000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000012','Synthetic property B');
UPDATE public.plans SET max_properties=1 WHERE code='LIFETIME';
DO $properties_block$ BEGIN
  BEGIN
    PERFORM public.billing_admin_action(
     '20000000-0000-0000-0000-000000000012','GRANT_LIFETIME',
     'Reject two existing properties with one licensed property',
     (SELECT id FROM public.plans WHERE code='LIFETIME'));
    RAISE EXCEPTION 'FAIL: over-property perpetual grant accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'Perpetual plan capacity exceeded' THEN RAISE; END IF;
  END;
END $properties_block$;
UPDATE public.plans SET max_properties=2000 WHERE code='LIFETIME';
DELETE FROM public.properties WHERE id IN (
 '60000000-0000-0000-0000-000000000011',
 '60000000-0000-0000-0000-000000000012');
SELECT pg_temp.assert_true(
 (SELECT count(*)=0 FROM public.audit_log
  WHERE organization_id='20000000-0000-0000-0000-000000000012'
    AND action='billing.admin_grant_lifetime'),
 'rejected grants do not issue audit success records');
SELECT pg_temp.assert_true(
 NOT EXISTS(SELECT 1 FROM public.subscriptions
  WHERE organization_id='20000000-0000-0000-0000-000000000012'),
 'rejected grants do not create lifetime subscriptions');

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
-- Repeating a successful grant must not reset the historic license start,
-- create an additional audit success or silently alter an irreversible term.
DO $duplicate_lifetime$
BEGIN
  BEGIN
    PERFORM public.billing_admin_action(
      '20000000-0000-0000-0000-000000000012','GRANT_LIFETIME',
      'Accidental duplicate perpetual action must be rejected',
      (SELECT id FROM public.plans WHERE code='LIFETIME'));
    RAISE EXCEPTION 'FAIL: duplicate lifetime grant accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'Perpetual license already active' THEN RAISE; END IF;
  END;
END $duplicate_lifetime$;
SELECT pg_temp.assert_true(
  (SELECT count(*)=1 FROM public.audit_log
   WHERE organization_id='20000000-0000-0000-0000-000000000012'
     AND action='billing.admin_grant_lifetime'),
  'duplicate grant must not generate a second success audit');
SELECT public.billing_admin_action(
  '20000000-0000-0000-0000-000000000012','SUSPEND',
  'Synthetic revoke of active infinite license',NULL);
SELECT pg_temp.assert_true(NOT jco_private.operational_access('20000000-0000-0000-0000-000000000012'),
 'suspension supersedes perpetual duration');
-- A perpetual grant cannot be used to unsuspend an organization; a
-- separate explicit and audited reactivation procedure must authorize it.
DO $blocked_unsuspend$
BEGIN
  BEGIN
    PERFORM public.billing_admin_action(
      '20000000-0000-0000-0000-000000000012','GRANT_LIFETIME',
      'Unauthorised attempt to reverse manual suspension with perpetual grant',
      (SELECT id FROM public.plans WHERE code='LIFETIME'));
    RAISE EXCEPTION 'FAIL: perpetual grant reversed a suspension';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'Suspended organization requires separate reactivation' THEN RAISE; END IF;
  END;
END $blocked_unsuspend$;
SELECT pg_temp.assert_true(
  (SELECT status='SUSPENDED' FROM public.organizations
   WHERE id='20000000-0000-0000-0000-000000000012')
  AND NOT jco_private.operational_access('20000000-0000-0000-0000-000000000012'),
  'suspended tenant remains blocked after rejected lifetime regrant');
SELECT pg_temp.assert_true(
  (SELECT count(*)=1 FROM public.audit_log
   WHERE organization_id='20000000-0000-0000-0000-000000000012'
     AND action='billing.admin_grant_lifetime'),
  'rejected unsuspension must not add successful lifetime audit');

SELECT pg_temp.assert_true((SELECT NOT production_enabled FROM public.billing_activation_settings),
 'no Wompi production activation');
