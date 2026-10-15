DO $check$
DECLARE
  b record;
  p record;
  l record;
BEGIN
 SELECT * INTO b FROM public.plans WHERE code='BASIC';
 SELECT * INTO p FROM public.plans WHERE code='PRO';
 SELECT * INTO l FROM public.plans WHERE code='LIFETIME';
 IF b.price<>129900 OR b.currency<>'COP' OR b.billing_cycle<>'MONTHLY'
    OR b.max_users<>5 OR b.max_properties<>200 OR b.max_storage_mb<>2048 OR b.ai_credits<>250
 THEN RAISE EXCEPTION 'BASIC has wrong price or changed plan limits'; END IF;
 IF p.price<>299900 OR p.currency<>'COP' OR p.billing_cycle<>'MONTHLY'
    OR p.max_users<>25 OR p.max_properties<>2000 OR p.max_storage_mb<>10240 OR p.ai_credits<>2000
 THEN RAISE EXCEPTION 'PRO has wrong price or changed plan limits'; END IF;
 IF l.billing_cycle<>'ONE_TIME' OR l.price<>0 OR l.currency<>'USD'
    OR l.max_users IS NOT NULL OR l.max_properties IS NOT NULL
 THEN RAISE EXCEPTION 'LIFETIME was unexpectedly changed'; END IF;
 IF (SELECT COUNT(*) FROM public.subscriptions)<>2 OR EXISTS (
  SELECT 1 FROM public.subscriptions WHERE status<>'TRIAL' OR billing_mode<>'SAAS_MONTHLY'
 ) THEN RAISE EXCEPTION 'Existing subscriptions were changed'; END IF;
 IF (SELECT COUNT(*) FROM public.payment_orders WHERE amount_in_cents=12990000)<>1
 THEN RAISE EXCEPTION 'Existing payment orders changed'; END IF;
 IF EXISTS (SELECT 1 FROM public.billing_activation_settings WHERE sandbox_enabled OR production_enabled)
 THEN RAISE EXCEPTION 'Payment switches were activated'; END IF;
 IF (SELECT COUNT(*) FROM public.plans WHERE code='ENTERPRISE' AND currency='USD' AND price=0)<>1
 THEN RAISE EXCEPTION 'Enterprise plan changed'; END IF;
END
$check$;
