-- Isolated PostgreSQL only. Run AFTER hotfix integration assertions and
-- security/rollback/wompi_trial_to_paid_20261017.sql.
CREATE OR REPLACE FUNCTION pg_temp.rollback_check(ok boolean,msg text) RETURNS void
 LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'rollback FAIL: %',msg; END IF; END $$;
SELECT pg_temp.rollback_check(
 to_regprocedure('public.billing_admin_reconcile_verified_trial_payment(uuid,text)') IS NULL,
 'owner reconciliation RPC removed');
SELECT pg_temp.rollback_check((
 SELECT status='APPROVED' AND fulfillment_status='APPLIED' FROM public.payment_orders
 WHERE reference='TRIAL_REVIEW_APPROVED_1'),
 'rollback MUST preserve already reconciled paid order');
SELECT pg_temp.rollback_check((
 SELECT count(*)=1 FROM public.payment_events
 WHERE provider_transaction_id='tx-historical-trial'),
 'rollback preserves signed payment evidence');
INSERT INTO public.organizations(id,name,slug,status)
 VALUES('20000000-0000-0000-0000-000000000009','Rollback Trial Fixture','trial-rollback','ACTIVE');
INSERT INTO public.organization_billing_access(organization_id,is_test,requires_payment)
 VALUES('20000000-0000-0000-0000-000000000009',true,true)
 ON CONFLICT(organization_id) DO UPDATE SET is_test=true,requires_payment=true;
INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,current_period_start,current_period_end)
 VALUES('20000000-0000-0000-0000-000000000009',
 (SELECT id FROM public.plans WHERE code='PRO'),'TRIAL','SAAS_MONTHLY',now()-interval '1 day',now()+interval '20 days')
 ON CONFLICT(organization_id) DO UPDATE SET plan_id=excluded.plan_id,status='TRIAL',
 current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
INSERT INTO public.organization_licenses(organization_id,license_type,status,starts_at,ends_at)
 VALUES('20000000-0000-0000-0000-000000000009',
 'SAAS','ACTIVE',now()-interval '1 day',now()+interval '20 days')
 ON CONFLICT(organization_id) DO UPDATE SET license_type='SAAS',status='ACTIVE',ends_at=excluded.ends_at;
INSERT INTO public.payment_orders(organization_id,plan_id,created_by,idempotency_key,
 environment,reference,billing_mode,amount_in_cents,currency,permission_keys,terms_version_id,expires_at)
 VALUES('20000000-0000-0000-0000-000000000009',
 (SELECT id FROM public.plans WHERE code='BASIC'),
 '10000000-0000-0000-0000-000000000001',gen_random_uuid(),
 'sandbox','ROLLBACK_TRIAL_GUARD_1','SAAS_MONTHLY',
 (SELECT (price*100)::bigint FROM public.plans WHERE code='BASIC'),'COP',
 ARRAY['properties.view'],(SELECT id FROM public.license_terms_versions LIMIT 1),now()+interval '25 minutes');
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $rollback_handler$
DECLARE result text;
BEGIN
  result := public.process_verified_payment_event('ROLLBACK_TRIAL_GUARD_1',
    'tx-roll-back-trial', (SELECT amount_in_cents FROM public.payment_orders WHERE reference='ROLLBACK_TRIAL_GUARD_1'),
    'COP','APPROVED','sandbox',repeat('6',64),repeat('4',64));
  IF result IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'Original Wompi handler rollback failed. actual=%',result;
  END IF;
END;
$rollback_handler$;
SELECT pg_temp.rollback_check((SELECT fulfillment_status='REVIEW_REQUIRED' AND review_reason='contract_review'
 FROM public.payment_orders WHERE reference='ROLLBACK_TRIAL_GUARD_1'),
 'prior stricter trial plan-change review restored');
SELECT pg_temp.rollback_check((SELECT status='TRIAL'
 FROM public.subscriptions WHERE organization_id='20000000-0000-0000-0000-000000000009'),
 'rollback did not silently activate new trial');
