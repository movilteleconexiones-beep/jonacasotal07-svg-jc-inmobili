-- G25: ISOLATED PG17 QA ONLY; NEVER apply to official Supabase.
-- Preserve the archived 0029 7-plan fixture and test the owner's explicit
-- 2026-11-22 change as a separate, isolated price overlay.
-- Changes only monthly BASIC and PRO prices in synthetic jco_pricing_test.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
DO $qa$
DECLARE n integer;
BEGIN
 IF current_database() <> 'jco_pricing_test'
 THEN RAISE EXCEPTION 'G25 QA-only overlay must never execute outside isolated test DB'; END IF;
 IF (SELECT count(*) FROM public.plans)<>7
 THEN RAISE EXCEPTION 'G25 QA historical seven-plan fixture missing'; END IF;
 IF (SELECT count(*) FROM public.plans WHERE
      (code='BASIC' AND billing_cycle='MONTHLY' AND price=104900 AND currency='COP')
   OR (code='PRO' AND billing_cycle='MONTHLY' AND price=194900 AND currency='COP'))<>2
 THEN RAISE EXCEPTION 'G25 QA historical amounts unexpected; fail closed'; END IF;

 UPDATE public.plans SET price=CASE code WHEN 'BASIC' THEN 149900::numeric
   WHEN 'PRO' THEN 349900::numeric END, updated_at=now()
 WHERE (code='BASIC' AND billing_cycle='MONTHLY' AND price=104900 AND currency='COP')
    OR (code='PRO' AND billing_cycle='MONTHLY' AND price=194900 AND currency='COP');
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>2 THEN RAISE EXCEPTION 'G25 QA expected exactly two prices updated, got %',n; END IF;

 IF (SELECT count(*) FROM public.plans WHERE
      (code='BASIC' AND billing_cycle='MONTHLY' AND price=149900 AND currency='COP')
   OR (code='PRO' AND billing_cycle='MONTHLY' AND price=349900 AND currency='COP'))<>2
 THEN RAISE EXCEPTION 'G25 QA final approved amounts wrong'; END IF;
END $qa$;
COMMIT;
