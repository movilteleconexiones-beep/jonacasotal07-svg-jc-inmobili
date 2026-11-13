-- G12: clone-only simulated production order/activation (NO Wompi network calls).
-- RUN ONLY with Supabase tool project_id=zjgstfgiirgjssnihaam.
-- The actor belongs to the designated is_test QA agency, NEVER SuperAdmin.
-- BEGIN..ROLLBACK guarantees zero production charges and zero durable records.
-- Simulated JWT via SET LOCAL ROLE does NOT certify genuine JWT nor real Wompi.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

DO $setup$
DECLARE
  qa_org uuid;
  qa_actor uuid;
  super_org uuid;
  changed integer;
BEGIN
  SELECT o.id,m.user_id INTO qa_org,qa_actor
  FROM public.organizations o
  JOIN public.organization_billing_access b
    ON b.organization_id=o.id AND b.is_test=true
  JOIN public.organization_members m
    ON m.organization_id=o.id AND m.status='ACTIVE'
  JOIN public.member_roles mr ON mr.organization_member_id=m.id
  JOIN public.roles r ON r.id=mr.role_id
    AND r.key='ORGANIZATION_OWNER' AND r.active
  JOIN public.license_acceptances a
    ON a.organization_id=o.id AND a.accepted_by=m.user_id
  JOIN public.license_terms_versions t
    ON t.id=a.terms_version_id AND t.active=true
  WHERE o.slug='sistema-inmobiliario-jco' AND o.status='ACTIVE'
  LIMIT 1;

  SELECT o.id INTO super_org FROM public.organizations o
  JOIN public.organization_billing_access b
    ON b.organization_id=o.id AND b.is_test=false
  JOIN public.subscriptions s
    ON s.organization_id=o.id AND s.status='LIFETIME'
  WHERE o.slug='jco-inmodigital-global';

  IF qa_org IS NULL OR qa_actor IS NULL OR super_org IS NULL OR qa_org=super_org
  THEN RAISE EXCEPTION 'G12 clone QA tenant or SuperAdmin lifetime guard missing'; END IF;
  IF (SELECT production_enabled FROM public.billing_activation_settings WHERE id=true)
  THEN RAISE EXCEPTION 'G12 must run on a clone whose LIVE switch is OFF'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.subscriptions s JOIN public.plans p ON p.id=s.plan_id
    WHERE s.organization_id=qa_org AND s.status='ACTIVE'
      AND s.billing_mode='SAAS_MONTHLY' AND p.code='BASIC'
  ) THEN RAISE EXCEPTION 'G12 clone QA is not on an active BASIC SaaS plan'; END IF;

  PERFORM set_config('jco.g12.qa_org',qa_org::text,true);
  PERFORM set_config('jco.g12.qa_actor',qa_actor::text,true);
  PERFORM set_config('jco.g12.super_org',super_org::text,true);
  PERFORM set_config('jco.g12.prior_expiry',
    (SELECT current_period_end::text FROM public.subscriptions WHERE organization_id=qa_org),true);

  -- Simulate a newly eligible commercial buyer only WITHIN this transaction.
  -- Never turn the protected SuperAdmin organization into a buyer.
  UPDATE public.organization_billing_access
    SET is_test=false WHERE organization_id=qa_org AND is_test=true;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'G12 QA merchant isolation setup failed'; END IF;
  UPDATE public.billing_activation_settings
    SET production_enabled=true WHERE id=true AND production_enabled=false;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'G12 temporary LIVE flag setup failed'; END IF;
END $setup$;

SET LOCAL ROLE authenticated;
DO $place_order$
DECLARE
  qa_org uuid:=current_setting('jco.g12.qa_org')::uuid;
  qa_actor uuid:=current_setting('jco.g12.qa_actor')::uuid;
  plan_id uuid;
  ord jsonb;
  requested uuid:=gen_random_uuid();
BEGIN
  PERFORM set_config('request.jwt.claim.sub',qa_actor::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub',qa_actor,'role','authenticated')::text,true);
  SELECT id INTO plan_id FROM public.plans
    WHERE code='BASIC' AND active AND billing_cycle='MONTHLY' AND currency='COP';
  IF plan_id IS NULL THEN RAISE EXCEPTION 'G12 BASIC plan not found'; END IF;
  ord:=public.billing_create_order(qa_org,plan_id,'production',requested);
  IF ord->>'status'<>'PENDING'
    OR ord->>'environment'<>'production'
    OR (ord->>'amount_in_cents')::bigint<>(SELECT (price*100)::bigint FROM public.plans WHERE id=plan_id)
    OR (ord->>'reference') NOT LIKE 'JCO_%'
  THEN RAISE EXCEPTION 'G12 order was not pending LIVE with correct amount'; END IF;
  IF ord IS DISTINCT FROM public.billing_create_order(qa_org,plan_id,'production',requested)
  THEN RAISE EXCEPTION 'G12 duplicate order request not idempotent'; END IF;
  PERFORM set_config('jco.g12.order_id',ord->>'id',true);
  PERFORM set_config('jco.g12.order_ref',ord->>'reference',true);
  PERFORM set_config('jco.g12.amount',ord->>'amount_in_cents',true);
END $place_order$;

SET LOCAL ROLE service_role;
DO $apply$
DECLARE
  ord_id uuid:=current_setting('jco.g12.order_id')::uuid;
  ord_ref text:=current_setting('jco.g12.order_ref');
  org_id uuid:=current_setting('jco.g12.qa_org')::uuid;
  tx_id text:='QA-ROLLBACK-'||replace(gen_random_uuid()::text,'-','');
  event_id text:=replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  payload_hash text:=repeat('b',64);
  result text;
  saved_period timestamptz:=current_setting('jco.g12.prior_expiry')::timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role','service_role')::text,true);

  result:=public.process_verified_payment_event(
    ord_ref,tx_id,current_setting('jco.g12.amount')::bigint,
    'COP','APPROVED','production',event_id,payload_hash);
  IF result<>'processed' THEN RAISE EXCEPTION 'G12 process failed: %',result; END IF;

  result:=public.process_verified_payment_event(
    ord_ref,tx_id,current_setting('jco.g12.amount')::bigint,
    'COP','APPROVED','production',event_id,payload_hash);
  IF result<>'duplicate' THEN RAISE EXCEPTION 'G12 replay not idempotent: %',result; END IF;

  IF (SELECT count(*) FROM public.payment_orders WHERE id=ord_id
       AND status='APPROVED' AND fulfillment_status='APPLIED'
       AND provider_transaction_id=tx_id)<>1
    OR (SELECT count(*) FROM public.payment_events WHERE payment_order_id=ord_id)<>1
    OR (SELECT count(*) FROM public.subscriptions
         WHERE organization_id=org_id AND status='ACTIVE' AND
               current_period_end > saved_period)<>1
    OR (SELECT count(*) FROM public.organization_licenses
         WHERE organization_id=org_id AND license_type='SAAS' AND status='ACTIVE')<>1
  THEN RAISE EXCEPTION 'G12 activation inconsistent or duplicate license/event'; END IF;

  IF (SELECT count(*) FROM public.subscriptions
      WHERE organization_id=current_setting('jco.g12.super_org')::uuid
      AND status='LIFETIME')<>1
  THEN RAISE EXCEPTION 'G12 SuperAdmin lifetime changed'; END IF;
  PERFORM set_config('jco.g12.pass','yes',true);
END $apply$;
RESET ROLE;
DO $verify$
BEGIN
  IF current_setting('jco.g12.pass',true)<>'yes'
  THEN RAISE EXCEPTION 'G12 transaction did not complete its checks'; END IF;
END $verify$;
ROLLBACK;
SELECT 'PASS: simulated LIVE billing RPC, one order, idempotent event, active license, SuperAdmin protected; ALL SQL WRITES ROLLED BACK (NO MONEY CHARGED)' AS evidence;
