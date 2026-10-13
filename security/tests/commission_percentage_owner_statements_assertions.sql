-- Isolated PostgreSQL 17 only; synthetic tenant and money.
INSERT INTO public.rent_payments(organization_id,lease_id,period_month,expected_amount,paid_amount,status)
VALUES
 ('11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333','2026-10-01',1800000,1800000,'PAID'),
 ('11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333','2026-11-01',1000000,1000000,'PAID');

SELECT set_config('jco_test.organization','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('jco_test.actor','10101010-1010-4010-8010-101010101010',false);
SET ROLE authenticated;

DO $test$
DECLARE settlement uuid; row public.owner_statements%ROWTYPE;
BEGIN
  settlement:=public.create_owner_draft_statement_by_percentage(
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333','2026-10-01',10,30000);
  SELECT * INTO row FROM public.owner_statements WHERE id=settlement;
  IF NOT FOUND OR row.status<>'DRAFT' OR row.gross_income<>1800000 OR
      row.commission_amount<>180000 OR row.tax_amount<>30000 OR row.net_amount<>1590000 THEN
    RAISE EXCEPTION '10%% of 1800000 must be COP 180000, found %/%/%',row.gross_income,row.commission_amount,row.net_amount;
  END IF;
END
$test$;

DO $test$
DECLARE settlement uuid; commission numeric;
BEGIN
  settlement:=public.create_owner_draft_statement_by_percentage(
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333','2026-11-01',12.5,0);
  SELECT commission_amount INTO commission FROM public.owner_statements WHERE id=settlement;
  IF commission<>125000 THEN RAISE EXCEPTION '12.5%% of 1000000 must be 125000'; END IF;
END
$test$;

DO $test$
DECLARE rejected boolean; rate numeric;
BEGIN
  FOREACH rate IN ARRAY ARRAY[-1::numeric,101::numeric,10.001::numeric] LOOP
    rejected:=false;
    BEGIN
      PERFORM public.create_owner_draft_statement_by_percentage(
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333','2027-01-01',rate,0);
    EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'Unsafe commission percentage accepted: %',rate; END IF;
  END LOOP;
END
$test$;

DO $test$
DECLARE denied boolean:=false;
BEGIN
  BEGIN
    PERFORM public.create_owner_draft_statement_by_percentage(
      '22222222-2222-4222-8222-222222222222',
      '44444444-4444-4444-8444-444444444444','2026-10-01',10,0);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-tenant commission write permitted'; END IF;
END
$test$;
RESET ROLE;

DO $final$
BEGIN
  IF (SELECT COUNT(*) FROM public.owner_statements)<>2 OR
     (SELECT COUNT(*) FROM public.rent_payments)<>2 OR
     (SELECT COUNT(*) FROM public.rent_receipts)<>0 THEN
    RAISE EXCEPTION 'Unexpected financial row mutation in synthetic test'; END IF;
  IF has_function_privilege('anon','public.create_owner_draft_statement_by_percentage(uuid,uuid,date,numeric,numeric)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.create_owner_draft_statement_by_percentage(uuid,uuid,date,numeric,numeric)','EXECUTE') THEN
    RAISE EXCEPTION 'RPC grants are incorrect'; END IF;
END
$final$;
SELECT 'PASS percent-based owner statements with original ledgers intact' AS result;
