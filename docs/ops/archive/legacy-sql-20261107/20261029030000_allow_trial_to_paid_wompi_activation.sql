-- INMOJCO: allow verified purchase of BASIC/PRO from a still-valid TRIAL
-- even when the trial's provisional plan differs from the purchased plan.
-- Preserve signed event verification, webhook idempotency, existing paid-plan
-- review, suspension, license review, tax gate and sandbox isolation.
-- Important: previously APPROVED/REVIEW_REQUIRED events are NOT replayed.
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.billing_create_order(uuid,uuid,text,uuid)') IS NULL
     OR to_regprocedure('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Verified Wompi billing functions are missing';
  END IF;
  IF position(
     's.current_period_end>now() AND s.plan_id<>target_plan'
     IN pg_get_functiondef('public.billing_create_order(uuid,uuid,text,uuid)'::regprocedure)
  )=0 OR position(
     'existing.current_period_end>now() AND existing.plan_id IS DISTINCT FROM payment.plan_id'
     IN pg_get_functiondef('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)'::regprocedure)
  )=0 THEN
    RAISE EXCEPTION 'Unexpected Wompi billing version: review before deploying';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.billing_create_order(target_org uuid, target_plan uuid, target_environment text, request_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE org public.organizations%ROWTYPE; account public.organization_billing_access%ROWTYPE;
  plan public.plans%ROWTYPE; settings public.billing_activation_settings%ROWTYPE;
  terms_id uuid; order_row public.payment_orders%ROWTYPE; keys text[];
BEGIN
  SELECT * INTO org FROM public.organizations WHERE id=target_org FOR UPDATE;
  IF request_key IS NULL OR NOT jco_private.billing_owner(target_org)
    THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO account FROM public.organization_billing_access WHERE organization_id=target_org;
  SELECT * INTO settings FROM public.billing_activation_settings WHERE id=true;
  IF org.status NOT IN ('ACTIVE','INACTIVE','TRIAL') THEN RAISE EXCEPTION 'Organization suspended or inactive'; END IF;
  IF target_environment NOT IN ('sandbox','production') OR target_environment IS NULL
    OR (target_environment='sandbox' AND (NOT settings.sandbox_enabled OR NOT account.is_test))
    OR (target_environment='production' AND (NOT settings.production_enabled OR account.is_test))
    THEN RAISE EXCEPTION 'Payments unavailable for this environment'; END IF;
  IF (now() AT TIME ZONE 'America/Bogota')::date >= date '2027-01-01'
    THEN RAISE EXCEPTION 'Tax configuration required'; END IF;
  SELECT * INTO order_row FROM public.payment_orders WHERE organization_id=target_org AND idempotency_key=request_key;
  IF FOUND THEN
    IF order_row.plan_id<>target_plan OR order_row.environment<>target_environment THEN RAISE EXCEPTION 'Request key conflict'; END IF;
    RETURN to_jsonb(order_row)-'permission_keys';
  END IF;
  -- Do not charge a customer again while an earlier APPROVED payment needs
  -- reconciliation. Retrying the SAME request key above remains idempotent.
  IF EXISTS (
    SELECT 1 FROM public.payment_orders po
    WHERE po.organization_id=target_org
      AND po.status='APPROVED'
      AND po.fulfillment_status='REVIEW_REQUIRED'
  ) THEN
    RAISE EXCEPTION 'Approved payment requires reconciliation';
  END IF;
  SELECT * INTO plan FROM public.plans WHERE id=target_plan AND active FOR SHARE;
  IF plan.id IS NULL OR plan.currency<>'COP' OR plan.price<=0 OR plan.price*100<>trunc(plan.price*100)
    OR plan.price*100>9007199254740991 OR plan.billing_cycle NOT IN ('MONTHLY','ANNUAL')
    THEN RAISE EXCEPTION 'Plan unavailable for automatic checkout'; END IF;
  IF EXISTS(SELECT 1 FROM public.subscriptions s WHERE organization_id=target_org AND
    (billing_mode NOT IN ('SAAS_MONTHLY','SAAS_ANNUAL') OR
      s.status NOT IN ('TRIAL','ACTIVE') OR
      (s.status='ACTIVE' AND s.current_period_end>now() AND s.plan_id<>target_plan)))
    THEN RAISE EXCEPTION 'Plan change requires administrative review'; END IF;
  -- Reject disallowed contracts before collecting a new payment.
  IF EXISTS (SELECT 1 FROM public.organization_licenses l
    WHERE l.organization_id=target_org AND
      (l.license_type<>'SAAS' OR l.status IN ('SUSPENDED','CANCELLED','TERMINATED')))
    THEN RAISE EXCEPTION 'License requires administrative review'; END IF;
  SELECT id INTO terms_id FROM public.license_terms_versions WHERE active ORDER BY effective_date DESC,created_at DESC LIMIT 1;
  IF terms_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.license_acceptances WHERE organization_id=target_org
    AND terms_version_id=terms_id AND accepted_by=auth.uid()) THEN RAISE EXCEPTION 'Accept current terms first'; END IF;
  SELECT array_agg(substr(feature_key,12) ORDER BY feature_key) INTO keys FROM public.plan_features
    WHERE plan_id=target_plan AND enabled AND feature_key LIKE 'permission:%';
  IF coalesce(cardinality(keys),0)=0 THEN RAISE EXCEPTION 'Plan permissions not configured'; END IF;
  IF (SELECT count(*) FROM public.payment_orders WHERE organization_id=target_org
    AND created_at>now()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'Too many payment attempts'; END IF;
  INSERT INTO public.payment_orders(organization_id,plan_id,created_by,idempotency_key,billing_mode,
    environment,reference,amount_in_cents,permission_keys,terms_version_id,expires_at)
  VALUES(target_org,target_plan,auth.uid(),request_key,
    CASE WHEN plan.billing_cycle='MONTHLY' THEN 'SAAS_MONTHLY' ELSE 'SAAS_ANNUAL' END,
    target_environment,'JCO_'||replace(gen_random_uuid()::text,'-',''),(plan.price*100)::bigint,keys,terms_id,now()+interval '30 minutes')
  RETURNING * INTO order_row;
  RETURN to_jsonb(order_row)-'permission_keys';
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_verified_payment_event(p_reference text, p_transaction_id text, p_amount_in_cents bigint, p_currency text, p_status text, p_environment text, p_event_id text, p_payload_sha256 text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE payment public.payment_orders%ROWTYPE; org public.organizations%ROWTYPE;
  account public.organization_billing_access%ROWTYPE; existing public.subscriptions%ROWTYPE;
  settings public.billing_activation_settings%ROWTYPE; start_at timestamptz; end_at timestamptz;
  reason text; prior_event public.payment_events%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('APPROVED','DECLINED','VOIDED','ERROR')
    OR p_event_id IS NULL OR p_event_id !~ '^[a-f0-9]{64}$'
    OR p_payload_sha256 IS NULL OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
    OR nullif(p_transaction_id,'') IS NULL THEN RETURN 'mismatch'; END IF;
  SELECT * INTO payment FROM public.payment_orders WHERE reference=p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF payment.environment IS DISTINCT FROM p_environment OR payment.amount_in_cents IS DISTINCT FROM p_amount_in_cents
    OR payment.currency IS DISTINCT FROM p_currency OR (payment.provider_transaction_id IS NOT NULL
      AND payment.provider_transaction_id<>p_transaction_id) THEN RETURN 'mismatch'; END IF;
  SELECT * INTO prior_event FROM public.payment_events WHERE provider='WOMPI' AND provider_event_id=p_event_id;
  IF FOUND THEN
    IF prior_event.payment_order_id=payment.id AND prior_event.provider_transaction_id=p_transaction_id
      AND prior_event.reported_status=p_status THEN RETURN 'duplicate'; END IF;
    RETURN 'conflict';
  END IF;
  -- Approved payments are immutable. Reversal events go to reconciliation.
  IF payment.status<>'PENDING' THEN RETURN 'conflict'; END IF;
  SELECT * INTO org FROM public.organizations WHERE id=payment.organization_id FOR UPDATE;
  SELECT * INTO account FROM public.organization_billing_access WHERE organization_id=org.id;
  SELECT * INTO settings FROM public.billing_activation_settings WHERE id=true;
  IF p_status='APPROVED' THEN
    SELECT * INTO existing FROM public.subscriptions WHERE organization_id=org.id FOR UPDATE;
    reason:=CASE
      WHEN payment.expires_at<=now() THEN 'expired_order'
      WHEN org.status NOT IN ('ACTIVE','INACTIVE','TRIAL') THEN 'organization_inactive'
      WHEN p_environment='sandbox' AND (NOT settings.sandbox_enabled OR NOT account.is_test) THEN 'sandbox_isolation'
      WHEN p_environment='production' AND (NOT settings.production_enabled OR account.is_test) THEN 'production_disabled'
      WHEN settings.activation_mode='MANUAL' THEN 'manual_approval'
      WHEN existing.id IS NOT NULL AND (existing.billing_mode NOT IN ('SAAS_MONTHLY','SAAS_ANNUAL')
        OR existing.status NOT IN ('TRIAL','ACTIVE')
        OR (existing.status='ACTIVE' AND existing.current_period_end>now() AND existing.plan_id IS DISTINCT FROM payment.plan_id)) THEN 'contract_review'
      WHEN EXISTS(SELECT 1 FROM public.organization_licenses WHERE organization_id=org.id
        AND (license_type<>'SAAS' OR status IN ('SUSPENDED','CANCELLED','TERMINATED'))) THEN 'license_review'
      ELSE NULL END;
    IF reason IS NULL THEN
      start_at:=CASE WHEN existing.status='ACTIVE' AND existing.current_period_end>now()
        THEN existing.current_period_start ELSE now() END;
      -- A trial never lengthens a newly purchased paid period.
      end_at:=greatest(now(), CASE WHEN existing.status='ACTIVE' THEN existing.current_period_end ELSE now() END)+
        CASE WHEN payment.billing_mode='SAAS_MONTHLY' THEN interval '1 month' ELSE interval '1 year' END;
    END IF;
  END IF;
  -- A verified payment is recorded even if its fulfillment needs review.
  INSERT INTO public.payment_events(payment_order_id,provider_event_id,provider_transaction_id,
    reported_status,payload_sha256) VALUES(payment.id,p_event_id,p_transaction_id,p_status,p_payload_sha256);
  UPDATE public.payment_orders SET status=p_status,provider_transaction_id=p_transaction_id,
    approved_at=CASE WHEN p_status='APPROVED' THEN now() END,
    fulfillment_status=CASE WHEN p_status<>'APPROVED' THEN 'NO_ACCESS' WHEN reason IS NULL THEN 'APPLIED' ELSE 'REVIEW_REQUIRED' END,
    review_reason=reason,updated_at=now() WHERE id=payment.id;
  IF p_status='APPROVED' AND reason IS NULL THEN
    INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,current_period_start,current_period_end)
      VALUES(org.id,payment.plan_id,'ACTIVE',payment.billing_mode,start_at,end_at)
      ON CONFLICT(organization_id) DO UPDATE SET plan_id=excluded.plan_id,status='ACTIVE',billing_mode=excluded.billing_mode,
        current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
        cancelled_at=NULL,updated_at=now();
    INSERT INTO public.organization_licenses(organization_id,license_type,status,starts_at,ends_at)
      VALUES(org.id,'SAAS','ACTIVE',start_at,end_at) ON CONFLICT(organization_id) DO UPDATE SET
        status='ACTIVE',starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=now();
    UPDATE public.organization_billing_access SET requires_payment=true,allowed_permissions=payment.permission_keys,
      manual_access_until=NULL,updated_at=now() WHERE organization_id=org.id;
    UPDATE public.organizations SET status='ACTIVE',plan_id=payment.plan_id,updated_at=now() WHERE id=org.id;
    INSERT INTO public.audit_log(organization_id,action,entity_type,entity_id,metadata)
      VALUES(org.id,'billing.payment_activated','payment_order',payment.id,
        jsonb_build_object('plan_id',payment.plan_id,'environment',p_environment,'period_end',end_at));
  END IF;
  RETURN 'processed';
END;
$function$;

-- CREATE OR REPLACE retains the existing owners, EXECUTE grants and RLS.
-- Do not reconcile a historical approved payment without fresh server-side
-- provider verification and a separate audited administrative operation.
COMMIT;
