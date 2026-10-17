-- Run ONLY after billing_activation_fixture + verified_tenant_billing +
-- commercial_plan_permissions + existing commercial activation assertions.
-- Isolated CI PostgreSQL; never on production.
CREATE OR REPLACE FUNCTION pg_temp.trial_check(ok boolean,msg text) RETURNS void
  LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'trial payment FAIL: %',msg; END IF; END $$;

-- New org: verified Sandbox order can replace a different CURRENT trial.
INSERT INTO public.organizations(id,name,slug,status)
  VALUES ('20000000-0000-0000-0000-000000000007','Trial Conversion Future','trial-future','ACTIVE');
INSERT INTO public.organization_billing_access(organization_id,is_test,requires_payment)
  VALUES ('20000000-0000-0000-0000-000000000007',true,true)
  ON CONFLICT(organization_id) DO UPDATE SET is_test=true,requires_payment=true;
INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,current_period_start,current_period_end)
 VALUES('20000000-0000-0000-0000-000000000007',
       (SELECT id FROM public.plans WHERE code='PRO'),'TRIAL','SAAS_MONTHLY',now()-interval '1 day',now()+interval '20 days')
 ON CONFLICT(organization_id) DO UPDATE SET plan_id=excluded.plan_id,status='TRIAL',
  billing_mode='SAAS_MONTHLY',current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
INSERT INTO public.organization_licenses(organization_id,license_type,status,starts_at,ends_at)
 VALUES('20000000-0000-0000-0000-000000000007','SAAS','ACTIVE',now()-interval '1 day',now()+interval '20 days')
 ON CONFLICT(organization_id) DO UPDATE SET license_type='SAAS',status='ACTIVE',ends_at=excluded.ends_at;
CREATE TEMP TABLE trial_periods AS SELECT organization_id,current_period_end
  FROM public.subscriptions WHERE organization_id='20000000-0000-0000-0000-000000000007';
INSERT INTO public.payment_orders(organization_id,plan_id,created_by,idempotency_key,
  environment,reference,billing_mode,amount_in_cents,currency,permission_keys,terms_version_id,expires_at)
VALUES('20000000-0000-0000-0000-000000000007',
  (SELECT id FROM public.plans WHERE code='BASIC'),
  '10000000-0000-0000-0000-000000000001',gen_random_uuid(),
  'sandbox','TRIAL_FUTURE_VERIFIED_1','SAAS_MONTHLY',
  (SELECT (price*100)::bigint FROM public.plans WHERE code='BASIC'),'COP',
  ARRAY['properties.view'],(SELECT id FROM public.license_terms_versions LIMIT 1),now()+interval '25 minutes');
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT pg_temp.trial_check(public.process_verified_payment_event('TRIAL_FUTURE_VERIFIED_1',
 'tx-future-trial', (SELECT amount_in_cents FROM public.payment_orders WHERE reference='TRIAL_FUTURE_VERIFIED_1'),
 'COP','APPROVED','sandbox',repeat('8',64),repeat('9',64))='processed','valid future trial payment processes');
SELECT pg_temp.trial_check((SELECT status='APPROVED' AND fulfillment_status='APPLIED'
 FROM public.payment_orders WHERE reference='TRIAL_FUTURE_VERIFIED_1'),'future trial purchase applied');
SELECT pg_temp.trial_check((SELECT s.status='ACTIVE' AND s.plan_id=(SELECT id FROM public.plans WHERE code='BASIC')
 AND s.current_period_end >= t.current_period_end+interval '1 month'
 FROM public.subscriptions s JOIN trial_periods t USING(organization_id)),'original trial days preserved plus paid month');
SELECT pg_temp.trial_check(public.process_verified_payment_event('TRIAL_FUTURE_VERIFIED_1',
 'tx-future-trial', (SELECT amount_in_cents FROM public.payment_orders WHERE reference='TRIAL_FUTURE_VERIFIED_1'),
 'COP','APPROVED','sandbox',repeat('8',64),repeat('9',64))='duplicate','repeat provider event idempotent');
SELECT pg_temp.trial_check((SELECT count(*)=1 FROM public.payment_events WHERE provider_transaction_id='tx-future-trial'),'one payment event');

-- Historical verified payment under a DIFFERENT still-valid TRIAL plan.
INSERT INTO public.organizations(id,name,slug,status)
 VALUES('20000000-0000-0000-0000-000000000008','Historical Verified','trial-history','ACTIVE');
INSERT INTO public.organization_billing_access(organization_id,is_test,requires_payment)
 VALUES('20000000-0000-0000-0000-000000000008',true,true)
 ON CONFLICT(organization_id) DO UPDATE SET is_test=true,requires_payment=true;
INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,current_period_start,current_period_end)
 VALUES('20000000-0000-0000-0000-000000000008',
 (SELECT id FROM public.plans WHERE code='PRO'),'TRIAL','SAAS_MONTHLY',now()-interval '1 day',now()+interval '20 days')
 ON CONFLICT(organization_id) DO UPDATE SET plan_id=excluded.plan_id,status='TRIAL',
 current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
INSERT INTO public.organization_licenses(organization_id,license_type,status,starts_at,ends_at)
 VALUES('20000000-0000-0000-0000-000000000008','SAAS','ACTIVE',now()-interval '1 day',now()+interval '20 days')
 ON CONFLICT(organization_id) DO UPDATE SET license_type='SAAS',status='ACTIVE',ends_at=excluded.ends_at;
CREATE TEMP TABLE historic_trial_period AS SELECT organization_id,current_period_end FROM public.subscriptions
 WHERE organization_id='20000000-0000-0000-0000-000000000008';
INSERT INTO public.payment_orders(organization_id,plan_id,created_by,idempotency_key,environment,
 reference,billing_mode,amount_in_cents,currency,permission_keys,terms_version_id,
 expires_at,status,fulfillment_status,review_reason,approved_at,provider_transaction_id)
VALUES('20000000-0000-0000-0000-000000000008',(SELECT id FROM public.plans WHERE code='BASIC'),
 '10000000-0000-0000-0000-000000000001',gen_random_uuid(),'sandbox','TRIAL_REVIEW_APPROVED_1',
 'SAAS_MONTHLY',(SELECT (price*100)::bigint FROM public.plans WHERE code='BASIC'),'COP',
 ARRAY['properties.view'],(SELECT id FROM public.license_terms_versions LIMIT 1),
 now()+interval '25 minutes','APPROVED','REVIEW_REQUIRED','contract_review',now(),'tx-historical-trial');
INSERT INTO public.payment_events(payment_order_id,provider_event_id,provider_transaction_id,
 reported_status,signature_valid,payload_sha256,processed_at)
VALUES((SELECT id FROM public.payment_orders WHERE reference='TRIAL_REVIEW_APPROVED_1'),
 repeat('7',64),'tx-historical-trial','APPROVED',true,repeat('b',64),now());
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
DO $deny$ BEGIN
  BEGIN
    PERFORM public.billing_admin_reconcile_verified_trial_payment(
      (SELECT id FROM public.payment_orders WHERE reference='TRIAL_REVIEW_APPROVED_1'),'attempt unauthorized');
    RAISE EXCEPTION 'FAIL normal user reconciled payment';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $deny$;
SELECT pg_temp.trial_check((SELECT fulfillment_status='REVIEW_REQUIRED'
 FROM public.payment_orders WHERE reference='TRIAL_REVIEW_APPROVED_1'),'normal user cannot alter reviewed payment');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
-- A paid ACTIVE subscription may not be replaced by this narrow trial-only workflow.
UPDATE public.subscriptions SET status='ACTIVE'
 WHERE organization_id='20000000-0000-0000-0000-000000000008';
SELECT pg_temp.trial_check(public.billing_admin_reconcile_verified_trial_payment(
 (SELECT id FROM public.payment_orders WHERE reference='TRIAL_REVIEW_APPROVED_1'),
 'Do not overwrite existing paid contract')='review_required','reject paid plan override');
UPDATE public.subscriptions SET status='TRIAL'
 WHERE organization_id='20000000-0000-0000-0000-000000000008';
SELECT pg_temp.trial_check(public.billing_admin_reconcile_verified_trial_payment(
 (SELECT id FROM public.payment_orders WHERE reference='TRIAL_REVIEW_APPROVED_1'),
 'Verified historical sandbox trial conversion')='applied','approved trial payment reconciled');
SELECT pg_temp.trial_check(public.billing_admin_reconcile_verified_trial_payment(
 (SELECT id FROM public.payment_orders WHERE reference='TRIAL_REVIEW_APPROVED_1'),
 'Idempotent repeated reconciliation')='already_applied','second application denied');
SELECT pg_temp.trial_check((SELECT status='APPROVED' AND fulfillment_status='APPLIED'
 AND review_reason IS NULL FROM public.payment_orders WHERE reference='TRIAL_REVIEW_APPROVED_1'),
 'historical order fulfilled without rewriting original approved payment');
SELECT pg_temp.trial_check((SELECT s.status='ACTIVE' AND s.plan_id=(SELECT id FROM public.plans WHERE code='BASIC')
 AND s.current_period_end=t.current_period_end+interval '1 month'
 FROM public.subscriptions s JOIN historic_trial_period t USING(organization_id)),
 'historical trial remaining period preserved plus paid month');
SELECT pg_temp.trial_check((SELECT count(*)=1 FROM public.payment_events WHERE provider_transaction_id='tx-historical-trial'),
 'historical Wompi verified event unchanged');
SELECT pg_temp.trial_check((SELECT count(*)=1 FROM public.audit_log
 WHERE action='billing.trial_paid_order_reconciled'
   AND entity_id=(SELECT id FROM public.payment_orders WHERE reference='TRIAL_REVIEW_APPROVED_1')),
 'exactly one admin audit event created');
SELECT pg_temp.trial_check(NOT EXISTS(SELECT 1 FROM public.subscriptions s
 JOIN public.organizations o ON o.id=s.organization_id
 WHERE o.slug='buyer-two' AND s.plan_id=(SELECT id FROM public.plans WHERE code='BASIC')),
 'different agency subscription untouched');
SELECT pg_temp.trial_check(NOT has_function_privilege('anon',
 'public.billing_admin_reconcile_verified_trial_payment(uuid,text)','EXECUTE'),
 'anonymous reconciliation unavailable');
DO $deny$ BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  BEGIN
    PERFORM public.billing_admin_reconcile_verified_trial_payment(
      (SELECT id FROM public.payment_orders WHERE reference='TRIAL_REVIEW_APPROVED_1'),
       'Service role may not administer checkout');
    RAISE EXCEPTION 'FAIL service role used reconciliation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $deny$;
