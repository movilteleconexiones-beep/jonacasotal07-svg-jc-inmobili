-- DRAFT ONLY: do not deploy without end-to-end sandbox tests.
-- Invoked exclusively from a trusted backend using service_role, never from browser.
-- Wompi signature MUST be verified by the backend before invoking this function.
BEGIN;

CREATE OR REPLACE FUNCTION public.process_verified_payment_event(
  p_reference text,
  p_transaction_id text,
  p_amount_in_cents bigint,
  p_currency text,
  p_status text,
  p_environment text,
  p_event_id text,
  p_payload_sha256 text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_event_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Server only';
  END IF;

  IF p_status NOT IN ('APPROVED','DECLINED','VOIDED','ERROR')
     OR p_event_id IS NULL OR length(p_event_id) = 0
     OR p_transaction_id IS NULL OR length(p_transaction_id) = 0
     OR p_payload_sha256 !~ '^[a-f0-9]{64}$' THEN
    RETURN 'mismatch';
  END IF;

  SELECT * INTO v_order
  FROM public.payment_orders
  WHERE reference = p_reference
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  IF v_order.environment IS DISTINCT FROM p_environment
    OR v_order.amount_in_cents IS DISTINCT FROM p_amount_in_cents
    OR v_order.currency IS DISTINCT FROM p_currency
    OR (v_order.provider_transaction_id IS NOT NULL AND v_order.provider_transaction_id <> p_transaction_id)
  THEN RETURN 'mismatch'; END IF;

  -- Repeated Wompi event: acknowledge without changing subscription again.
  IF EXISTS (
    SELECT 1 FROM public.payment_events
    WHERE provider = 'WOMPI' AND provider_event_id = p_event_id
      AND payment_order_id = v_order.id
      AND payload_sha256 = p_payload_sha256
  ) THEN RETURN 'duplicate'; END IF;

  -- A repeated ID with different data must not be silently accepted.
  IF EXISTS (SELECT 1 FROM public.payment_events
    WHERE provider = 'WOMPI' AND provider_event_id = p_event_id)
  THEN RETURN 'conflict'; END IF;

  IF v_order.status <> 'PENDING' THEN RETURN 'conflict'; END IF;

  INSERT INTO public.payment_events (
    payment_order_id,provider,provider_event_id,provider_transaction_id,
    reported_status,signature_valid,payload_sha256,processed_at
  ) VALUES (
    v_order.id,'WOMPI',p_event_id,p_transaction_id,p_status,true,p_payload_sha256,now()
  ) RETURNING id INTO v_event_id;

  UPDATE public.payment_orders
  SET status = p_status,
      provider_transaction_id = p_transaction_id,
      approved_at = CASE WHEN p_status = 'APPROVED' THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = v_order.id;

  -- Do not automatically activate subscriptions until the license grant
  -- procedure and price/plan checks are implemented and reviewed.
  RETURN 'processed';
END;
$$;

REVOKE ALL ON FUNCTION public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)
  TO service_role;

COMMIT;
