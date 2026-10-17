-- STAGING FIRST. Financial change: requires validated recovery prior to production.
-- 1) Future verified TRIAL -> different paid plan no longer gets contract_review.
-- 2) Existing signed APPROVED sandbox review may be reconciled exactly once
--    by the exclusive platform owner, with strict event/tenant/contract checks.
BEGIN;
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
      WHEN org.status NOT IN ('ACTIVE','TRIAL') THEN 'organization_inactive'
      WHEN p_environment='sandbox' AND (NOT settings.sandbox_enabled OR NOT account.is_test) THEN 'sandbox_isolation'
      WHEN p_environment='production' AND (NOT settings.production_enabled OR account.is_test) THEN 'production_disabled'
      WHEN settings.activation_mode='MANUAL' THEN 'manual_approval'
      WHEN existing.id IS NOT NULL AND (existing.billing_mode NOT IN ('SAAS_MONTHLY','SAAS_ANNUAL')
        OR existing.status IN ('LIFETIME','SUSPENDED','CANCELLED')
        OR (existing.status <> 'TRIAL' AND existing.current_period_end>now()
          AND existing.plan_id IS DISTINCT FROM payment.plan_id)) THEN 'contract_review'
      WHEN EXISTS(SELECT 1 FROM public.organization_licenses WHERE organization_id=org.id
        AND (license_type<>'SAAS' OR status IN ('SUSPENDED','CANCELLED','TERMINATED'))) THEN 'license_review'
      ELSE NULL END;
    IF reason IS NULL THEN
      start_at:=CASE WHEN existing.status='ACTIVE' AND existing.current_period_end>now()
        THEN existing.current_period_start ELSE now() END;
      end_at:=greatest(now(),coalesce(existing.current_period_end,now()))+
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
-- Resolves ONLY a previously verified, paid Sandbox order blocked because a
-- still-valid TRIAL subscription has a DIFFERENT plan. Never touches payment
-- events or provider transaction identifiers, and never creates a new payment.
-- Access: exclusive platform SuperAdmin, with reason and auditable idempotence.
CREATE OR REPLACE FUNCTION public.billing_admin_reconcile_verified_trial_payment(
  target_order uuid, justification text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $reconcile$
DECLARE
  payment public.payment_orders%ROWTYPE;
  current_org public.organizations%ROWTYPE;
  access_row public.organization_billing_access%ROWTYPE;
  sub public.subscriptions%ROWTYPE;
  lic public.organization_licenses%ROWTYPE;
  price_plan public.plans%ROWTYPE;
  gate public.billing_activation_settings%ROWTYPE;
  actual_events integer;
  paid_end timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR NOT public.is_platform_admin()
    THEN RAISE EXCEPTION 'Exclusive platform administrator required' USING ERRCODE='42501';
  END IF;
  IF target_order IS NULL OR length(btrim(coalesce(justification,''))) < 10
    THEN RAISE EXCEPTION 'Reason of at least ten characters required';
  END IF;
  SELECT * INTO payment FROM public.payment_orders WHERE id=target_order FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF payment.fulfillment_status='APPLIED' THEN RETURN 'already_applied'; END IF;
  IF payment.environment <> 'sandbox' OR payment.status <> 'APPROVED'
    OR payment.fulfillment_status <> 'REVIEW_REQUIRED' OR payment.review_reason <> 'contract_review'
    OR payment.billing_mode NOT IN ('SAAS_MONTHLY','SAAS_ANNUAL')
    OR payment.provider <> 'WOMPI' OR payment.provider_transaction_id IS NULL
    OR payment.approved_at IS NULL OR payment.approved_at > payment.expires_at
    OR coalesce(cardinality(payment.permission_keys),0)=0 OR payment.terms_version_id IS NULL
    THEN RETURN 'review_required';
  END IF;
  SELECT count(*) INTO actual_events FROM public.payment_events e
   WHERE e.payment_order_id=payment.id AND e.provider='WOMPI'
     AND e.reported_status='APPROVED' AND e.signature_valid IS TRUE
     AND e.processed_at IS NOT NULL
     AND e.provider_transaction_id=payment.provider_transaction_id;
  IF actual_events <> 1 OR
     (SELECT count(*) FROM public.payment_events WHERE payment_order_id=payment.id) <> 1
    THEN RETURN 'review_required';
  END IF;
  SELECT * INTO current_org FROM public.organizations
    WHERE id=payment.organization_id FOR UPDATE;
  SELECT * INTO access_row FROM public.organization_billing_access
    WHERE organization_id=payment.organization_id FOR UPDATE;
  SELECT * INTO gate FROM public.billing_activation_settings WHERE id=true;
  SELECT * INTO sub FROM public.subscriptions
    WHERE organization_id=payment.organization_id FOR UPDATE;
  SELECT * INTO lic FROM public.organization_licenses
    WHERE organization_id=payment.organization_id FOR UPDATE;
  SELECT * INTO price_plan FROM public.plans WHERE id=payment.plan_id;
  IF current_org.status NOT IN ('ACTIVE','TRIAL') OR access_row.is_test IS DISTINCT FROM true
    OR gate.sandbox_enabled IS DISTINCT FROM true OR gate.production_enabled IS DISTINCT FROM false
    OR gate.activation_mode IS DISTINCT FROM 'VERIFIED_PAYMENT'
    OR sub.id IS NULL OR sub.status <> 'TRIAL'
    OR sub.billing_mode NOT IN ('SAAS_MONTHLY','SAAS_ANNUAL')
    OR sub.plan_id IS NOT DISTINCT FROM payment.plan_id
    OR sub.current_period_end <= now() OR sub.current_period_start IS NULL
    OR lic.id IS NULL OR lic.license_type <> 'SAAS' OR lic.status <> 'ACTIVE'
    OR price_plan.id IS NULL OR price_plan.active IS DISTINCT FROM true
    OR price_plan.currency <> payment.currency OR price_plan.currency <> 'COP'
    OR price_plan.price * 100 <> payment.amount_in_cents
    OR (payment.billing_mode='SAAS_MONTHLY' AND price_plan.billing_cycle <> 'MONTHLY')
    OR (payment.billing_mode='SAAS_ANNUAL' AND price_plan.billing_cycle <> 'ANNUAL')
    THEN RETURN 'review_required';
  END IF;
  -- Preserve the remaining original trial AND append the purchased paid term.
  paid_end:=greatest(sub.current_period_end,payment.approved_at) +
    CASE WHEN payment.billing_mode='SAAS_MONTHLY' THEN interval '1 month'
         ELSE interval '1 year' END;
  UPDATE public.subscriptions SET plan_id=payment.plan_id,status='ACTIVE',
    billing_mode=payment.billing_mode,current_period_start=payment.approved_at,
    current_period_end=paid_end,cancelled_at=NULL,updated_at=now()
    WHERE id=sub.id AND status='TRIAL';
  IF NOT FOUND THEN RAISE EXCEPTION 'Trial changed concurrently'; END IF;
  UPDATE public.organization_licenses SET status='ACTIVE',
    starts_at=payment.approved_at,ends_at=paid_end,updated_at=now()
    WHERE id=lic.id AND license_type='SAAS' AND status='ACTIVE';
  UPDATE public.organization_billing_access SET requires_payment=true,
    allowed_permissions=payment.permission_keys,manual_access_until=NULL,updated_at=now()
    WHERE organization_id=current_org.id AND is_test=true;
  UPDATE public.organizations SET status='ACTIVE',plan_id=payment.plan_id,updated_at=now()
    WHERE id=current_org.id AND status IN ('ACTIVE','TRIAL');
  UPDATE public.payment_orders SET fulfillment_status='APPLIED',
    review_reason=NULL,updated_at=now() WHERE id=payment.id
    AND status='APPROVED' AND fulfillment_status='REVIEW_REQUIRED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Paid order changed concurrently'; END IF;
  INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES(current_org.id,auth.uid(),'billing.trial_paid_order_reconciled','payment_order',payment.id,
      jsonb_build_object('from_plan_id',sub.plan_id,'to_plan_id',payment.plan_id,
        'environment','sandbox','verified_payment',true,
        'original_review_reason','contract_review','period_end',paid_end,
        'reason',btrim(justification)));
  RETURN 'applied';
END;
$reconcile$;
REVOKE ALL ON FUNCTION public.billing_admin_reconcile_verified_trial_payment(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.billing_admin_reconcile_verified_trial_payment(uuid,text)
  TO authenticated;

COMMIT;
