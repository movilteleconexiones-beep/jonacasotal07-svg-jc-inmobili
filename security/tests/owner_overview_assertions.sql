CREATE FUNCTION pg_temp.assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
SELECT pg_temp.assert((SELECT count(*)=1 FROM public.license_acceptances),'accepted terms not duplicated');
SELECT pg_temp.assert((SELECT a.accepted_at=o.accepted_at AND a.accepted_by=o.accepted_by
  AND a.organization_license_id=o.organization_license_id AND a.terms_version_id=o.terms_version_id
  AND a.terms_snapshot='ORIGINAL LEGAL TEXT' AND a.acceptance_user_agent=o.user_agent
  AND a.organization_id='20000000-0000-0000-0000-000000000001'
  FROM public.license_acceptances a JOIN original_acceptances o USING(id)),'old legal identity and date preserved');
SELECT pg_temp.assert((SELECT l.status=o.status AND l.starts_at=o.starts_at FROM public.organization_licenses l JOIN original_licenses o USING(id)),'legacy license untouched');
SELECT pg_temp.assert(NOT has_table_privilege('authenticated','public.organization_licenses','UPDATE'),'no direct license activation');
SELECT pg_temp.assert(NOT has_function_privilege('anon','public.platform_organization_overview(integer)','EXECUTE'),'overview is private');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT public.create_organization_with_owner('Owner Test','owner-test','CO');
SELECT pg_temp.assert((SELECT status='TRIAL' FROM public.organizations WHERE slug='owner-test'),'legacy bootstrap cannot grant unpaid access');
SELECT pg_temp.assert((SELECT count(*)=1 AND bool_and(status='PENDING') FROM public.organization_licenses
 WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='owner-test')),'bootstrap keeps exactly one pending license');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.subscriptions),'bootstrap creates no free commercial subscription');
-- A real acceptance submitted through the older client derives the new fields.
INSERT INTO public.license_acceptances(organization_license_id,terms_version_id,accepted_by,user_agent)
 SELECT id,'40000000-0000-0000-0000-000000000001',auth.uid(),'older client'
 FROM public.organization_licenses WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='owner-test');
SELECT pg_temp.assert((SELECT organization_id=(SELECT id FROM public.organizations WHERE slug='owner-test')
 AND terms_snapshot='ORIGINAL LEGAL TEXT' AND acceptance_user_agent='older client' FROM public.license_acceptances
 WHERE accepted_by=auth.uid()),'older client acceptance remains compatible');
DO $$ BEGIN
 BEGIN PERFORM public.platform_organization_overview(); RAISE EXCEPTION 'FAIL customer overview'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.billing_admin_authorize_trial((SELECT id FROM public.organizations WHERE slug='owner-test'),auth.uid(),
  (SELECT id FROM public.plans WHERE code='PRO'),30,'Owner test request'); RAISE EXCEPTION 'FAIL customer approval'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',false);
DO $$ BEGIN BEGIN PERFORM public.platform_organization_overview(); RAISE EXCEPTION 'FAIL support overview'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
-- A no-charge trial also works before the legacy price catalog is configured.
UPDATE public.plans SET currency='USD',price=0 WHERE code='PRO';
CREATE TEMP TABLE prices_before_trial AS TABLE public.plans;
SELECT public.billing_admin_authorize_trial((SELECT id FROM public.organizations WHERE slug='owner-test'),
 '10000000-0000-0000-0000-000000000001',(SELECT id FROM public.plans WHERE code='PRO'),30,'Owner test explicitly requested');
SELECT pg_temp.assert((SELECT is_test AND requires_payment AND manual_access_until>now()+interval '29 days'
 FROM public.organization_billing_access WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='owner-test')),'time-limited test authorization');
SELECT pg_temp.assert((SELECT status='TRIAL' AND current_period_end=trial_ends_at FROM public.subscriptions),'trial is not a paid subscription');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM public.payment_orders),'trial invents no payments');
SELECT pg_temp.assert(NOT EXISTS(SELECT * FROM public.plans EXCEPT SELECT * FROM prices_before_trial),'trial preserves commercial prices');
SELECT pg_temp.assert((SELECT NOT sandbox_enabled AND NOT production_enabled FROM public.billing_activation_settings),'trial enables no charging');
SELECT pg_temp.assert((SELECT metadata->>'payment_received'='false' FROM public.audit_log WHERE action='billing.owner_trial_authorized'),'trial audit states no payment');
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
SELECT pg_temp.assert(NOT public.is_platform_admin(),'customer gains no platform administration');
SELECT pg_temp.assert(public.has_org_permission((SELECT id FROM public.organizations WHERE slug='owner-test'),'reports.view'),'complete trial includes reporting');
SELECT pg_temp.assert(public.has_org_permission((SELECT id FROM public.organizations WHERE slug='owner-test'),'documents.view'),'complete trial includes documents');
-- Rental access follows commercial validity even with an old permissive policy.
UPDATE public.organization_billing_access SET manual_access_until=now()-interval '1 second'
 WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='owner-test');
SET ROLE authenticated;
DO $$ BEGIN BEGIN INSERT INTO public.leases(organization_id) VALUES((SELECT id FROM public.organizations WHERE slug='owner-test'));
 RAISE EXCEPTION 'FAIL expired rental write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
INSERT INTO public.organizations(name,slug) VALUES('Inactive Test','inactive-test');
UPDATE public.organizations SET status='INACTIVE' WHERE slug='inactive-test';
-- 02:00 UTC on the first belongs to the preceding Colombian registration month.
UPDATE public.organizations SET created_at=date_trunc('month',now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'UTC'+interval '2 hours' WHERE slug='legacy-principal';
CREATE TEMP TABLE overview_result AS SELECT public.platform_organization_overview(12) AS value;
SELECT pg_temp.assert((SELECT value#>>'{totals,total}'='3' AND value#>>'{totals,inactive}'='1'
 AND value#>>'{totals,expired}'='1' AND value#>>'{totals,tests}'='1' FROM overview_result),'overview includes inactive and expired tests');
SELECT pg_temp.assert((SELECT jsonb_array_length(value->'monthly')=12 FROM overview_result),'complete monthly range includes zero months');
SELECT pg_temp.assert((SELECT (m->>'registered')::integer=1 FROM overview_result,jsonb_array_elements(value->'monthly') m
 WHERE m->>'month'=to_char(date_trunc('month',now() AT TIME ZONE 'America/Bogota')-interval '1 month','YYYY-MM')),'Bogota month boundary');
SELECT pg_temp.assert((SELECT sum((m->>'registered')::integer)=3 FROM overview_result,jsonb_array_elements(value->'monthly') m),'monthly totals reconcile');
-- Audit failure must roll back the entire renewed trial.
CREATE TEMP TABLE trial_before AS SELECT * FROM public.organization_billing_access WHERE is_test;
CREATE FUNCTION public.reject_trial_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.action='billing.owner_trial_authorized' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trial_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.reject_trial_audit();
DO $$ BEGIN BEGIN PERFORM public.billing_admin_authorize_trial((SELECT id FROM public.organizations WHERE slug='owner-test'),
 '10000000-0000-0000-0000-000000000001',(SELECT id FROM public.plans WHERE code='PRO'),30,'Audit rollback test');
 RAISE EXCEPTION 'FAIL partial trial'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected audit failure' THEN RAISE; END IF; END; END $$;
SELECT pg_temp.assert((SELECT b.manual_access_until=t.manual_access_until FROM public.organization_billing_access b JOIN trial_before t USING(organization_id)),'audit failure leaves access unchanged');
DROP TRIGGER trial_audit_failure ON public.audit_log;
DROP FUNCTION public.reject_trial_audit();
UPDATE public.subscriptions SET status='ACTIVE';
DO $$ BEGIN BEGIN PERFORM public.billing_admin_authorize_trial((SELECT id FROM public.organizations WHERE slug='owner-test'),
 '10000000-0000-0000-0000-000000000001',(SELECT id FROM public.plans WHERE code='PRO'),30,'Cannot overwrite paid contract');
 RAISE EXCEPTION 'FAIL paid contract trial'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Commercial or platform account cannot become a trial' THEN RAISE; END IF; END; END $$;
