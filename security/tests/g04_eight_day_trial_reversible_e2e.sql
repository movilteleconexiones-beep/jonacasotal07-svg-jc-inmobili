-- #203 G04: reversible hosted E2E against production schema, NO persistent writes.
-- Run ONLY as BEGIN + candidate DDL + this test + ROLLBACK in one session.
-- Payment event below is a synthetic SANDBOX callback, not a real Wompi charge.
-- This toggle is transaction-local and MUST be rolled back: never enable LIVE in production.
BEGIN;
SET LOCAL statement_timeout='45s';
SET LOCAL lock_timeout='5s';
DO $preflight$
BEGIN
  IF current_user <> 'postgres' OR NOT EXISTS(
    SELECT 1 FROM public.billing_activation_settings WHERE id=true AND production_enabled=false
  ) THEN
    RAISE EXCEPTION 'QA must run as postgres while real commercial payments are disabled';
  END IF;
END $preflight$;
UPDATE public.billing_activation_settings SET production_enabled=true WHERE id=true;
DO $g04$
DECLARE
  v_actor uuid; v_org uuid; v_other uuid; v_terms uuid; v_basic uuid; v_pro uuid;
  v_end timestamptz; v_again timestamptz; v_denied boolean;
  v_order jsonb; v_result text; v_period timestamptz;
BEGIN
  SELECT m.user_id INTO STRICT v_actor
    FROM public.organization_members m
    JOIN public.organizations o ON o.id=m.organization_id
    JOIN public.organization_billing_access b ON b.organization_id=o.id AND b.is_test
    WHERE o.slug='sistema-inmobiliario-jco' AND m.status='ACTIVE' LIMIT 1;
  IF EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=v_actor AND active) THEN
    RAISE EXCEPTION 'QA actor must not have platform privileges';
  END IF;
  SELECT id INTO STRICT v_terms FROM public.license_terms_versions WHERE active
    ORDER BY effective_date DESC, created_at DESC LIMIT 1;
  SELECT id INTO STRICT v_basic FROM public.plans WHERE active AND code='BASIC';
  SELECT id INTO STRICT v_pro FROM public.plans WHERE active AND code='PRO';
  IF has_function_privilege('anon','public.billing_start_eight_day_trial(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.billing_start_eight_day_trial(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Trial RPC privilege contract invalid';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_denied:=false;
  BEGIN
    PERFORM public.billing_start_eight_day_trial(
      (SELECT id FROM public.organizations WHERE slug='sistema-inmobiliario-jco'),v_basic);
  EXCEPTION WHEN check_violation THEN v_denied:=true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Sandbox agency obtained another commercial trial'; END IF;

  v_org:=public.create_organization_with_owner('INMOJCO ficticia G04 8 dias',
    'qa-g04-trial-'||left(replace(gen_random_uuid()::text,'-',''),16),'CO');
  v_denied:=false;
  BEGIN PERFORM public.billing_start_eight_day_trial(v_org,v_basic);
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Trial started before legal terms accepted'; END IF;
  PERFORM public.billing_accept_terms(v_org,v_terms,'QA no persistence');
  v_end:=public.billing_start_eight_day_trial(v_org,v_basic);
  v_again:=public.billing_start_eight_day_trial(v_org,v_basic);
  IF v_end IS DISTINCT FROM v_again
     OR v_end < now()+interval '7 days 23 hours'
     OR v_end > now()+interval '8 days 1 hour' THEN
    RAISE EXCEPTION 'Trial duration/idempotence invalid';
  END IF;
  IF NOT jco_private.operational_access(v_org) THEN
    RAISE EXCEPTION 'Trial did not activate correctly'; END IF;
  IF (SELECT count(*) FROM public.audit_log WHERE organization_id=v_org
        AND action='billing.trial_started')<>1
     OR (SELECT status FROM public.subscriptions WHERE organization_id=v_org)<>'TRIAL'
     OR (SELECT is_test FROM public.organization_billing_access WHERE organization_id=v_org)
     OR (SELECT status FROM public.organizations WHERE id=v_org)<>'ACTIVE' THEN
    RAISE EXCEPTION 'Trial metadata wrong or audit duplicated'; END IF;
  v_denied:=false;
  BEGIN PERFORM public.billing_start_eight_day_trial(v_org,v_pro);
  EXCEPTION WHEN check_violation THEN v_denied:=true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Trial plan changed free of charge'; END IF;

  v_other:=public.create_organization_with_owner('INMOJCO segunda sociedad ficticia',
    'qa-g04-second-'||left(replace(gen_random_uuid()::text,'-',''),16),'CO');
  PERFORM public.billing_accept_terms(v_other,v_terms,'QA second company');
  v_denied:=false;
  BEGIN PERFORM public.billing_start_eight_day_trial(v_other,v_basic);
  EXCEPTION WHEN check_violation THEN v_denied:=true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Owner obtained a second free trial'; END IF;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  v_denied:=false;
  BEGIN PERFORM public.billing_start_eight_day_trial(v_other,v_basic);
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Unknown user could activate a trial'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  EXECUTE 'RESET ROLE';

  -- Expired subscriptions and licenses must fail closed, even if org ACTIVE.
  UPDATE public.subscriptions SET current_period_end=now()-interval '1 minute',
    trial_ends_at=now()-interval '1 minute' WHERE organization_id=v_org;
  UPDATE public.organization_licenses SET ends_at=now()-interval '1 minute'
    WHERE organization_id=v_org;
  IF jco_private.operational_access(v_org) THEN
    RAISE EXCEPTION 'Expired trial still operational'; END IF;
  UPDATE public.subscriptions SET current_period_end=v_end,trial_ends_at=v_end
    WHERE organization_id=v_org;
  UPDATE public.organization_licenses SET ends_at=v_end WHERE organization_id=v_org;
  IF NOT jco_private.operational_access(v_org) THEN
    RAISE EXCEPTION 'Valid trial was not restored'; END IF;

  -- SANDBOX conversion: test only inside this transaction. Never enable LIVE.
  UPDATE public.organization_billing_access SET is_test=true WHERE organization_id=v_org;
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_order:=public.billing_create_order(v_org,v_basic,'sandbox',gen_random_uuid());
  EXECUTE 'RESET ROLE';
  IF v_order->>'reference' IS NULL OR (v_order->>'amount_in_cents')::bigint<1 THEN
    RAISE EXCEPTION 'Sandbox payment order missing'; END IF;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  EXECUTE 'SET LOCAL ROLE service_role';
  v_result:=public.process_verified_payment_event(
    v_order->>'reference','qa-g04-'||replace(gen_random_uuid()::text,'-',''),
    (v_order->>'amount_in_cents')::bigint,'COP','APPROVED','sandbox',
    encode(gen_random_bytes(32),'hex'),encode(gen_random_bytes(32),'hex'));
  EXECUTE 'RESET ROLE';
  IF v_result IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'Sandbox payment not applied: %',v_result; END IF;
  SELECT current_period_end INTO STRICT v_period
    FROM public.subscriptions WHERE organization_id=v_org
      AND status='ACTIVE' AND trial_ends_at=v_end;
  IF v_period < now()+interval '27 days' OR v_period > now()+interval '35 days'
     OR (SELECT manual_access_until IS NOT NULL FROM public.organization_billing_access
           WHERE organization_id=v_org) THEN
    RAISE EXCEPTION 'Payment incorrectly includes free trial days'; END IF;
END
$g04$;
ROLLBACK;
