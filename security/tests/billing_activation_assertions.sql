CREATE FUNCTION pg_temp.assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
SELECT pg_temp.assert((SELECT status='ACTIVE' FROM public.organizations WHERE slug='legacy-principal'),'principal unchanged');
SELECT pg_temp.assert((SELECT NOT requires_payment FROM public.organization_billing_access WHERE organization_id='20000000-0000-0000-0000-000000000001'),'legacy access preserved');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)','EXECUTE'),'no user payment grant RPC');
SELECT pg_temp.assert(NOT has_function_privilege('anon','public.billing_admin_action(uuid,text,text,uuid)','EXECUTE'),'no public admin RPC');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','public.platform_set_subscription(uuid,text,text,text)','EXECUTE'),'old bypass closed');
SELECT pg_temp.assert(NOT has_table_privilege('authenticated','public.payment_events','SELECT'),'private event audit');
SELECT pg_temp.assert(NOT has_table_privilege('authenticated','public.payment_orders','INSERT'),'orders only through RPC');
SELECT pg_temp.assert((SELECT NOT sandbox_enabled AND NOT production_enabled FROM public.billing_activation_settings),'charging defaults disabled');
INSERT INTO public.organizations(id,name,slug,status) VALUES
 ('20000000-0000-0000-0000-000000000002','Buyer One','buyer-one','ACTIVE'),
 ('20000000-0000-0000-0000-000000000003','Buyer Two','buyer-two','ACTIVE'),
 ('20000000-0000-0000-0000-000000000004','Real Buyer','real-buyer','ACTIVE');
SELECT pg_temp.assert((SELECT bool_and(status='TRIAL') FROM public.organizations WHERE slug LIKE '%buyer%'),'bootstrap cannot activate unpaid buyers');
INSERT INTO public.organization_members(id,organization_id,user_id,status) VALUES
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','ACTIVE'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','ACTIVE'),
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','ACTIVE');
INSERT INTO public.roles(id,organization_id,key) SELECT m.id,m.organization_id,'ORGANIZATION_OWNER' FROM public.organization_members m;
INSERT INTO public.member_roles SELECT id,id FROM public.organization_members;
INSERT INTO public.role_permissions SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p;
INSERT INTO public.license_terms_versions(id,version,title,terms_markdown) VALUES('40000000-0000-0000-0000-000000000001','1','Fixture terms','TEST TERMS ONLY');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT pg_temp.assert(NOT public.has_org_permission('20000000-0000-0000-0000-000000000002','properties.view'),'unpaid owner blocked');
SELECT pg_temp.assert((public.billing_get_access('20000000-0000-0000-0000-000000000002')->>'can_manage_billing')::boolean,'unpaid owner can reach billing');
DO $$ BEGIN
 BEGIN PERFORM public.billing_get_access('20000000-0000-0000-0000-000000000003'); RAISE EXCEPTION 'FAIL cross tenant billing'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.billing_admin_action('20000000-0000-0000-0000-000000000002','APPROVE','Unauthorised approval',(SELECT id FROM public.plans WHERE code='BASIC')); RAISE EXCEPTION 'FAIL customer admin'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT public.billing_accept_terms('20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','fixture');
SELECT public.billing_accept_terms('20000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','fixture replay');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.license_acceptances WHERE organization_id='20000000-0000-0000-0000-000000000002'),'acceptance idempotent');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',false);
SELECT pg_temp.assert(NOT public.is_platform_admin(),'support is not SuperAdmin');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
SELECT public.billing_admin_action('20000000-0000-0000-0000-000000000002','MARK_TEST','Isolated Sandbox test');
UPDATE public.billing_activation_settings SET sandbox_enabled=true;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
-- A provisional PRO trial may purchase BASIC. A paid ACTIVE plan change
-- still requires review, but an unpaid TRIAL is not a paid contract.
INSERT INTO public.subscriptions (organization_id,plan_id,status,billing_mode,current_period_start,current_period_end)
VALUES ('20000000-0000-0000-0000-000000000002',
        (SELECT id FROM public.plans WHERE code='PRO'),'TRIAL','SAAS_MONTHLY',
        now()-interval '1 day',now()+interval '5 days');
SELECT public.billing_create_order('20000000-0000-0000-0000-000000000002',
       (SELECT id FROM public.plans WHERE code='BASIC'),'sandbox',
       '50000000-0000-0000-0000-000000000009');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.payment_orders
       WHERE idempotency_key='50000000-0000-0000-0000-000000000009'
         AND status='PENDING'), 'trial Basic checkout is payable');
DELETE FROM public.payment_orders
 WHERE idempotency_key='50000000-0000-0000-0000-000000000009';
SELECT pg_temp.assert((SELECT count(*)=0 FROM public.payment_orders),
  'trial checkout fixture cleaned up');
-- A terminal subscription must not create a payable same-plan checkout either.
UPDATE public.subscriptions SET status='SUSPENDED', plan_id=(SELECT id FROM public.plans WHERE code='BASIC')
 WHERE organization_id='20000000-0000-0000-0000-000000000002';
DO $suspended_guard$ BEGIN
  BEGIN
    PERFORM public.billing_create_order('20000000-0000-0000-0000-000000000002',
      (SELECT id FROM public.plans WHERE code='BASIC'),'sandbox',gen_random_uuid());
    RAISE EXCEPTION 'FAIL: suspended subscription accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Plan change requires administrative review%' THEN RAISE; END IF;
  END;
END $suspended_guard$;
UPDATE public.subscriptions SET status='CANCELLED'
 WHERE organization_id='20000000-0000-0000-0000-000000000002';
DO $cancelled_guard$ BEGIN
  BEGIN
    PERFORM public.billing_create_order('20000000-0000-0000-0000-000000000002',
      (SELECT id FROM public.plans WHERE code='BASIC'),'sandbox',gen_random_uuid());
    RAISE EXCEPTION 'FAIL: cancelled subscription accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Plan change requires administrative review%' THEN RAISE; END IF;
  END;
END $cancelled_guard$;
SELECT pg_temp.assert((SELECT count(*)=0 FROM public.payment_orders),
  'terminal subscription must not create a payable order');
-- Simulate trial expiry before the standard happy-path checkout.
DELETE FROM public.subscriptions WHERE organization_id='20000000-0000-0000-0000-000000000002';
SELECT public.billing_create_order('20000000-0000-0000-0000-000000000002',(SELECT id FROM public.plans WHERE code='BASIC'),'sandbox','50000000-0000-0000-0000-000000000001');
SELECT public.billing_create_order('20000000-0000-0000-0000-000000000002',(SELECT id FROM public.plans WHERE code='BASIC'),'sandbox','50000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.payment_orders),'checkout retry does not duplicate order');
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT pg_temp.assert(public.process_verified_payment_event((SELECT reference FROM public.payment_orders LIMIT 1),'tx-wrong-amount',1,'COP','APPROVED','sandbox',repeat('a',64),repeat('b',64))='mismatch','wrong amount denied');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.subscriptions),'mismatch gives no subscription');
SELECT pg_temp.assert(public.process_verified_payment_event((SELECT reference FROM public.payment_orders LIMIT 1),'tx-ok',10490000,'COP','APPROVED','sandbox',repeat('a',64),repeat('b',64))='processed','valid payment processed');
SELECT pg_temp.assert(public.process_verified_payment_event((SELECT reference FROM public.payment_orders LIMIT 1),'tx-ok',10490000,'COP','APPROVED','sandbox',repeat('a',64),repeat('c',64))='duplicate','redelivered raw event never regrants');
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.subscriptions),'one subscription');
SELECT pg_temp.assert((SELECT status='ACTIVE' FROM public.organization_licenses WHERE organization_id='20000000-0000-0000-0000-000000000002'),'license activated with subscription');
SELECT pg_temp.assert((SELECT fulfillment_status='APPLIED' FROM public.payment_orders LIMIT 1),'fulfillment recorded');
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT pg_temp.assert(public.has_org_permission('20000000-0000-0000-0000-000000000002','properties.view'),'paid Basic module granted');
SELECT pg_temp.assert(NOT public.has_org_permission('20000000-0000-0000-0000-000000000002','reports.view'),'Basic does not get Pro reporting');
SELECT pg_temp.assert(NOT public.has_org_permission('20000000-0000-0000-0000-000000000003','properties.view'),'other tenant remains unpaid');
-- A production customer cannot use a Sandbox checkout even when globally enabled.
DO $$ BEGIN
 BEGIN PERFORM public.billing_create_order('20000000-0000-0000-0000-000000000004',(SELECT id FROM public.plans WHERE code='BASIC'),'sandbox',gen_random_uuid()); RAISE EXCEPTION 'FAIL sandbox access';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='FAIL sandbox access' THEN RAISE; END IF; END;
END $$;
-- Renewals preserve the current period start and add exactly one paid period.
CREATE TEMP TABLE first_period AS SELECT * FROM public.subscriptions;
SELECT public.billing_create_order('20000000-0000-0000-0000-000000000002',(SELECT id FROM public.plans WHERE code='BASIC'),'sandbox','50000000-0000-0000-0000-000000000002');
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT public.process_verified_payment_event((SELECT reference FROM public.payment_orders WHERE idempotency_key='50000000-0000-0000-0000-000000000002'),'tx-renew',10490000,'COP','APPROVED','sandbox',repeat('d',64),repeat('e',64));
SELECT pg_temp.assert((SELECT s.current_period_start=f.current_period_start AND s.current_period_end=f.current_period_end+interval '1 month' FROM public.subscriptions s JOIN first_period f USING(organization_id)),'renewal preserves access now');
-- A payment cannot reverse an administrative suspension.
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT public.billing_create_order('20000000-0000-0000-0000-000000000002',(SELECT id FROM public.plans WHERE code='BASIC'),'sandbox','50000000-0000-0000-0000-000000000003');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
SELECT public.billing_admin_action('20000000-0000-0000-0000-000000000002','SUSPEND','Administrative security suspension');
SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT public.process_verified_payment_event((SELECT reference FROM public.payment_orders WHERE idempotency_key='50000000-0000-0000-0000-000000000003'),'tx-suspended',10490000,'COP','APPROVED','sandbox',repeat('f',64),repeat('1',64));
SELECT pg_temp.assert((SELECT status='SUSPENDED' FROM public.organizations WHERE slug='buyer-one'),'suspension survives paid webhook');
SELECT pg_temp.assert((SELECT status='APPROVED' AND fulfillment_status='REVIEW_REQUIRED' FROM public.payment_orders WHERE idempotency_key='50000000-0000-0000-0000-000000000003'),'paid amount retained for review');
-- Restrictive policies deny writes even if a legacy policy grants all members.
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN INSERT INTO public.properties(organization_id,title) VALUES('20000000-0000-0000-0000-000000000002','Denied'); RAISE EXCEPTION 'FAIL unpaid write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.properties),'blocked write leaves no property');
-- Failed audit insert rolls back payment, license and subscription together.
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
SELECT public.billing_admin_action('20000000-0000-0000-0000-000000000003','MARK_TEST','Atomic failure isolated fixture');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
SELECT public.billing_accept_terms('20000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','fixture');
SELECT public.billing_create_order('20000000-0000-0000-0000-000000000003',(SELECT id FROM public.plans WHERE code='PRO'),'sandbox','50000000-0000-0000-0000-000000000004');
CREATE FUNCTION public.billing_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.payment_activated' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER billing_test_fail BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.billing_test_audit_failure();
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$ BEGIN
 BEGIN PERFORM public.process_verified_payment_event((SELECT reference FROM public.payment_orders WHERE idempotency_key='50000000-0000-0000-0000-000000000004'),'tx-atomic',19490000,'COP','APPROVED','sandbox',repeat('2',64),repeat('3',64));
 RAISE EXCEPTION 'FAIL audit rollback'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected audit failure' THEN RAISE; END IF; END;
END $$;
DROP TRIGGER billing_test_fail ON public.audit_log;
DROP FUNCTION public.billing_test_audit_failure();
SELECT pg_temp.assert((SELECT status='PENDING' FROM public.payment_orders WHERE idempotency_key='50000000-0000-0000-0000-000000000004'),'failed transaction keeps order pending');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE organization_id='20000000-0000-0000-0000-000000000003'),'no partial subscription');
SELECT pg_temp.assert((SELECT status='PENDING' FROM public.organization_licenses WHERE organization_id='20000000-0000-0000-0000-000000000003'),'no partial license');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.payment_events WHERE provider_event_id=repeat('2',64)),'no partial audit event');
-- Manual mode records the real payment while withholding access for review.
UPDATE public.billing_activation_settings SET activation_mode='MANUAL';
SELECT public.process_verified_payment_event((SELECT reference FROM public.payment_orders WHERE idempotency_key='50000000-0000-0000-0000-000000000004'),'tx-manual',19490000,'COP','APPROVED','sandbox',repeat('4',64),repeat('5',64));
SELECT pg_temp.assert((SELECT status='APPROVED' AND fulfillment_status='REVIEW_REQUIRED' AND review_reason='manual_approval' FROM public.payment_orders WHERE idempotency_key='50000000-0000-0000-0000-000000000004'),'manual approval required');
SELECT pg_temp.assert(NOT jco_private.operational_access('20000000-0000-0000-0000-000000000003'),'manual payment does not silently activate');
UPDATE public.billing_activation_settings SET activation_mode='VERIFIED_PAYMENT';
-- Leave another isolated pending order for the real PostgreSQL concurrency test.
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT public.billing_create_order('20000000-0000-0000-0000-000000000003',(SELECT id FROM public.plans WHERE code='PRO'),'sandbox','50000000-0000-0000-0000-000000000005');
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('propiedades','20000000-0000-0000-0000-000000000002/other-tenant.jpg'); RAISE EXCEPTION 'FAIL other tenant image'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('propiedades','unscoped.jpg'); RAISE EXCEPTION 'FAIL unscoped image'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
