-- Approved 2026-10-15 commercial prices for SaaS monthly subscriptions only.
-- Explicitly preserve existing organization subscriptions, license rights,
-- entitlement limits, price history in existing payment orders, and LIFETIME.
-- Wompi production / sandbox switches remain OFF.
BEGIN;

DO $migration$
DECLARE
  basic public.plans%ROWTYPE;
  professional public.plans%ROWTYPE;
  vitalicia public.plans%ROWTYPE;
  affected integer;
BEGIN
  IF (SELECT count(*) FROM public.plans
       WHERE code IN ('BASIC','PRO','LIFETIME')) <> 3 THEN
    RAISE EXCEPTION 'Unexpected plan catalog: BASIC, PRO and LIFETIME required';
  END IF;

  SELECT * INTO basic FROM public.plans WHERE code='BASIC' FOR UPDATE;
  SELECT * INTO professional FROM public.plans WHERE code='PRO' FOR UPDATE;
  SELECT * INTO vitalicia FROM public.plans WHERE code='LIFETIME' FOR SHARE;

  IF basic.billing_cycle <> 'MONTHLY' OR professional.billing_cycle <> 'MONTHLY'
     OR vitalicia.billing_cycle <> 'ONE_TIME'
     OR NOT basic.active OR NOT professional.active OR NOT vitalicia.active THEN
    RAISE EXCEPTION 'Unexpected plan cycle or status; do not change subscriptions';
  END IF;

  -- Must be either entirely at the observed legacy price or entirely applied.
  -- A partially edited or unexpected catalog is a fail-closed conflict.
  IF basic.currency='COP' AND basic.price=129900
     AND professional.currency='COP' AND professional.price=299900 THEN
    RETURN;
  END IF;
  IF NOT (basic.currency='USD' AND basic.price=0
          AND professional.currency='USD' AND professional.price=0) THEN
    RAISE EXCEPTION 'Catalog changed unexpectedly: manual review required';
  END IF;

  UPDATE public.plans
  SET currency='COP',
      price=CASE code WHEN 'BASIC' THEN 129900
                      WHEN 'PRO' THEN 299900 END,
      updated_at=now()
  WHERE code IN ('BASIC','PRO') AND billing_cycle='MONTHLY'
        AND currency='USD' AND price=0;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two commercial price updates, got %',affected;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.plans
                 WHERE code='LIFETIME' AND billing_cycle='ONE_TIME'
                   AND currency=vitalicia.currency AND price=vitalicia.price
                   AND max_users IS NOT DISTINCT FROM vitalicia.max_users
                   AND max_properties IS NOT DISTINCT FROM vitalicia.max_properties)
  THEN
    RAISE EXCEPTION 'Lifetime plan must remain untouched';
  END IF;
END
$migration$;

COMMIT;
