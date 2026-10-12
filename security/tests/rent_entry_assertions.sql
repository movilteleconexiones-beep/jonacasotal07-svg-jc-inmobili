-- Test transactions and permissions as an authenticated member of tenant A.
CREATE FUNCTION pg_temp.must_fail(sql text, expected_state text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE result_state text;
BEGIN
 BEGIN EXECUTE sql;
 EXCEPTION WHEN OTHERS THEN result_state:=SQLSTATE;
 END;
 IF result_state IS DISTINCT FROM expected_state THEN
  RAISE EXCEPTION 'Expected SQLSTATE %, got % in %',
    expected_state,coalesce(result_state,'SUCCESS'),sql;
 END IF;
END;
$$;

DO $checks$
BEGIN
 IF has_table_privilege('authenticated','public.rent_payments','INSERT') OR
    has_table_privilege('authenticated','public.rent_payments','UPDATE') OR
    has_table_privilege('authenticated','public.rent_receipts','INSERT') OR
    has_table_privilege('authenticated','public.rent_receipts','UPDATE') OR
    has_table_privilege('authenticated','public.rent_receipts','DELETE') THEN
   RAISE EXCEPTION 'Direct financial writes were not revoked';
 END IF;
END
$checks$;

SET ROLE authenticated;
SET jco_test.actor = '99999999-9999-4999-8999-999999999999';
SET jco_test.organization = '11111111-1111-4111-8111-111111111111';

-- The public invoker has no direct ability to edit the aggregate.
SELECT pg_temp.must_fail($$
 UPDATE public.rent_payments SET paid_amount=999999
 WHERE organization_id='11111111-1111-4111-8111-111111111111'
$$,'42501');

SELECT pg_temp.must_fail($$
 SELECT public.create_tenant_rent_period('22222222-2222-4222-8222-222222222222',
 '44444444-4444-4444-8444-444444444444','2026-10-01')
$$,'42501');

SELECT pg_temp.must_fail($$
 SELECT public.create_tenant_rent_period('11111111-1111-4111-8111-111111111111',
 '55555555-5555-4555-8555-555555555555','2026-10-01')
$$,'23514');

SELECT pg_temp.must_fail($$
 SELECT public.create_tenant_rent_period('11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333','2026-10-04')
$$,'22023');

SELECT public.create_tenant_rent_period(
 '11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333','2026-10-01') AS period_id \gset
SELECT set_config('jco_test.period_id', :'period_id', false);

SELECT pg_temp.must_fail($$
 SELECT public.create_tenant_rent_period('11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333','2026-10-01')
$$,'23505');

SELECT public.record_tenant_rent_receipt(
 '11111111-1111-4111-8111-111111111111',current_setting('jco_test.period_id')::uuid,
 600000,'BANK_TRANSFER','COMPROBANTE-PAGO-A-001',
 '88888888-8888-4888-8888-888888888888') AS receipt_one \gset
SELECT set_config('jco_test.receipt_one', :'receipt_one', false);

DO $checks$
DECLARE prior_paid numeric;
BEGIN
 SELECT paid_amount INTO prior_paid FROM public.rent_payments
 WHERE id=current_setting('jco_test.period_id')::uuid;
 IF prior_paid<>600000 THEN RAISE EXCEPTION 'Initial payment was not credited atomically'; END IF;
END
$checks$;

-- A repeated request cannot double-credit the same receipt.
SELECT public.record_tenant_rent_receipt(
 '11111111-1111-4111-8111-111111111111',current_setting('jco_test.period_id')::uuid,
 600000,'BANK_TRANSFER','COMPROBANTE-PAGO-A-001',
 '88888888-8888-4888-8888-888888888888') AS same_receipt \gset
SELECT set_config('jco_test.same_receipt', :'same_receipt', false);

DO $checks$
BEGIN
 IF current_setting('jco_test.receipt_one')::uuid IS DISTINCT FROM current_setting('jco_test.same_receipt')::uuid THEN
   RAISE EXCEPTION 'Idempotency did not return the original receipt';
 END IF;
 IF (SELECT count(*) FROM public.rent_receipts)<>1 THEN
   RAISE EXCEPTION 'Duplicate entry created';
 END IF;
END
$checks$;

SELECT pg_temp.must_fail($$
 SELECT public.record_tenant_rent_receipt(
 '11111111-1111-4111-8111-111111111111',current_setting('jco_test.period_id')::uuid,
 5000,'BANK_TRANSFER','COMPROBANTE-PAGO-A-001',
 '88888888-8888-4888-8888-888888888888')
$$,'23505');

SELECT public.record_tenant_rent_receipt(
 '11111111-1111-4111-8111-111111111111',current_setting('jco_test.period_id')::uuid,
 1000000,'CASH','RECIBO-EFECTIVO-002',
 '77777777-7777-4777-8777-777777777777') AS receipt_two \gset

DO $checks$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.rent_payments
   WHERE id=current_setting('jco_test.period_id')::uuid AND paid_amount=1600000 AND
     expected_amount=1600000 AND status='PAID' AND paid_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Failed to settle monthly period correctly'; END IF;
END
$checks$;

SELECT pg_temp.must_fail($$
 SELECT public.record_tenant_rent_receipt(
 '11111111-1111-4111-8111-111111111111',current_setting('jco_test.period_id')::uuid,
 1,'CASH','RECIBO-EFECTIVO-EXCESO',
 '66666666-6666-4666-8666-666666666666')
$$,'23514');

SELECT pg_temp.must_fail($$
 SELECT public.record_tenant_rent_receipt(
 '11111111-1111-4111-8111-111111111111',current_setting('jco_test.period_id')::uuid,
 -1,'CASH','RECIBO-INVALIDO',
 '55555555-5555-4555-8555-555555555555')
$$,'22023');

SELECT pg_temp.must_fail($$
 SELECT public.create_owner_draft_statement(
  '22222222-2222-4222-8222-222222222222',
  '44444444-4444-4444-8444-444444444444','2026-10-01',100000,0)
$$,'42501');

SELECT public.create_owner_draft_statement(
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333','2026-10-01',160000,30000)
  AS owner_statement_id \gset
SELECT set_config('jco_test.owner_statement_id', :'owner_statement_id', false);

DO $checks$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.owner_statements
  WHERE id=current_setting('jco_test.owner_statement_id')::uuid AND gross_income=1600000 AND
  commission_amount=160000 AND tax_amount=30000 AND
  other_deductions=0 AND net_amount=1410000 AND status='DRAFT')
 THEN RAISE EXCEPTION 'Incorrect initial owner statement'; END IF;
END
$checks$;

SELECT pg_temp.must_fail($$
 SELECT public.create_owner_draft_statement(
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333','2026-10-01',160000,30000)
$$,'23505');

SELECT pg_temp.must_fail($$
 SELECT public.create_owner_draft_statement(
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333','2026-11-01',9999999,0)
$$,'23514');

-- Approved owner utilities update the net; TENANT expenses do not.
INSERT INTO public.owner_statement_deductions
  (id,organization_id,statement_id,charge_date,category,responsible_party,amount,description,support_reference)
VALUES
 ('98989898-9898-4898-8898-989898989898',
 '11111111-1111-4111-8111-111111111111',current_setting('jco_test.owner_statement_id')::uuid,
 '2026-10-01','WATER','OWNER',120000,'Agua a cargo del propietario','AGUA-PRUEBA-001'),
 ('97979797-9797-4797-8797-979797979797',
 '11111111-1111-4111-8111-111111111111',current_setting('jco_test.owner_statement_id')::uuid,
 '2026-10-01','ELECTRICITY','TENANT',70000,'Energía a cargo del inquilino','ENERGIA-PRUEBA-001');

SELECT pg_temp.must_fail($reject$
 SELECT public.reconcile_owner_draft_statement(
   '11111111-1111-4111-8111-111111111111',
   current_setting('jco_test.owner_statement_id')::uuid)
$reject$,'23514');

UPDATE public.owner_statement_deductions SET status='APPROVED'
WHERE id IN ('98989898-9898-4898-8898-989898989898',
             '97979797-9797-4797-8797-979797979797');

SELECT public.reconcile_owner_draft_statement(
 '11111111-1111-4111-8111-111111111111',
 current_setting('jco_test.owner_statement_id')::uuid);

DO $checks$
BEGIN
 IF NOT EXISTS(
 SELECT 1 FROM public.owner_statements WHERE
 id=current_setting('jco_test.owner_statement_id')::uuid AND
 gross_income=1600000 AND other_deductions=120000 AND net_amount=1290000
 ) THEN RAISE EXCEPTION 'Owner net failed to exclude TENANT utility expense'; END IF;
END
$checks$;

SELECT pg_temp.must_fail($reject$
 SELECT public.reconcile_owner_draft_statement(
   '22222222-2222-4222-8222-222222222222',
   current_setting('jco_test.owner_statement_id')::uuid)
$reject$,'42501');

RESET ROLE;
DO $checks$
BEGIN
 IF (SELECT count(*) FROM public.rent_receipts)<>2 THEN
   RAISE EXCEPTION 'Unexpected count of immutable receipt events';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies
   WHERE tablename='rent_receipts' AND policyname='rent_receipts_view'
     AND cmd='SELECT') THEN RAISE EXCEPTION 'Missing read RLS'; END IF;
END
$checks$;
