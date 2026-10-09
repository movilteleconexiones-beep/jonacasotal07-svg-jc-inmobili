-- DRAFT ONLY. Apply after 0026/0027 in staging, not production.
-- Replaces the 0027 RPC so payment approval and subscription activation are atomic.
-- LIFETIME requires a separate legal acceptance workflow and is intentionally not auto-activated.
BEGIN;
CREATE OR REPLACE FUNCTION public.process_verified_payment_event(
 p_reference text,p_transaction_id text,p_amount_in_cents bigint,p_currency text,
 p_status text,p_environment text,p_event_id text,p_payload_sha256 text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
 v_order public.payment_orders%ROWTYPE;
 v_plan public.plans%ROWTYPE;
 v_existing public.subscriptions%ROWTYPE;
 v_start timestamptz;
 v_end timestamptz;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Server only'; END IF;
 IF p_status NOT IN ('APPROVED','DECLINED','VOIDED','ERROR')
 OR nullif(p_event_id,'') IS NULL OR nullif(p_transaction_id,'') IS NULL
 OR p_payload_sha256 !~ '^[a-f0-9]{64}$' THEN RETURN 'mismatch'; END IF;

 SELECT * INTO v_order FROM public.payment_orders WHERE reference=p_reference FOR UPDATE;
 IF NOT FOUND THEN RETURN 'not_found'; END IF;
 IF v_order.environment IS DISTINCT FROM p_environment
 OR v_order.amount_in_cents IS DISTINCT FROM p_amount_in_cents
 OR v_order.currency IS DISTINCT FROM p_currency
 OR (v_order.provider_transaction_id IS NOT NULL AND v_order.provider_transaction_id <> p_transaction_id)
 THEN RETURN 'mismatch'; END IF;

 IF EXISTS(SELECT 1 FROM public.payment_events
   WHERE provider='WOMPI' AND provider_event_id=p_event_id
   AND payment_order_id=v_order.id AND payload_sha256=p_payload_sha256)
 THEN RETURN 'duplicate'; END IF;
 IF EXISTS(SELECT 1 FROM public.payment_events WHERE provider='WOMPI' AND provider_event_id=p_event_id)
 THEN RETURN 'conflict'; END IF;
 IF v_order.status <> 'PENDING' THEN RETURN 'conflict'; END IF;

 IF p_status='APPROVED' THEN
   SELECT * INTO v_plan FROM public.plans WHERE id=v_order.plan_id AND active=true;
   IF NOT FOUND OR v_plan.currency <> 'COP' OR v_plan.price <= 0
     OR (v_plan.price*100) <> v_order.amount_in_cents
     OR (v_order.billing_mode='SAAS_MONTHLY' AND v_plan.billing_cycle <> 'MONTHLY')
     OR (v_order.billing_mode='SAAS_ANNUAL' AND v_plan.billing_cycle <> 'ANNUAL')
     OR v_order.billing_mode='LIFETIME'
   THEN RETURN 'mismatch'; END IF;
   -- Serialize subscription renewals for the tenant even across different orders.
   PERFORM 1 FROM public.organizations WHERE id=v_order.organization_id FOR UPDATE;
   IF NOT FOUND THEN RETURN 'not_found'; END IF;
   SELECT * INTO v_existing FROM public.subscriptions
     WHERE organization_id=v_order.organization_id FOR UPDATE;
   v_start := greatest(now(),coalesce(v_existing.current_period_end,now()));
   v_end := CASE WHEN v_order.billing_mode='SAAS_MONTHLY'
     THEN v_start+interval '1 month' ELSE v_start+interval '1 year' END;
 END IF;

 INSERT INTO public.payment_events(payment_order_id,provider,provider_event_id,
  provider_transaction_id,reported_status,signature_valid,payload_sha256,processed_at)
 VALUES(v_order.id,'WOMPI',p_event_id,p_transaction_id,p_status,true,p_payload_sha256,now());

 UPDATE public.payment_orders SET status=p_status,provider_transaction_id=p_transaction_id,
   approved_at=CASE WHEN p_status='APPROVED' THEN now() ELSE NULL END,updated_at=now()
 WHERE id=v_order.id;

 IF p_status='APPROVED' THEN
   INSERT INTO public.subscriptions(organization_id,plan_id,status,billing_mode,
     current_period_start,current_period_end,updated_at)
   VALUES(v_order.organization_id,v_order.plan_id,'ACTIVE',v_order.billing_mode,
     v_start,v_end,now())
   ON CONFLICT(organization_id) DO UPDATE SET
     plan_id=excluded.plan_id,status='ACTIVE',billing_mode=excluded.billing_mode,
     current_period_start=excluded.current_period_start,
     current_period_end=excluded.current_period_end,updated_at=now();
   UPDATE public.organizations SET plan_id=v_order.plan_id,status='ACTIVE',updated_at=now()
     WHERE id=v_order.organization_id;
 END IF;
 RETURN 'processed';
END;
$$;
REVOKE ALL ON FUNCTION public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)
 TO service_role;
COMMIT;
