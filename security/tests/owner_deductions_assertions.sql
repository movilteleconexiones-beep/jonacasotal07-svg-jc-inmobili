-- Run only after fixture + migration in an isolated PostgreSQL 17 database.
-- Each anticipated rejection is checked by SQLSTATE; unexpected errors fail CI.
CREATE FUNCTION pg_temp.expect_failure(statement text, expected_code text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE observed text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN observed := SQLSTATE;
  END;
  IF observed IS DISTINCT FROM expected_code THEN
    RAISE EXCEPTION 'Expected SQLSTATE %, got %: %', expected_code, coalesce(observed,'SUCCESS'), statement;
  END IF;
END;
$fn$;

SET ROLE authenticated;
SET jco_test.actor = '99999999-9999-4999-8999-999999999999';
SET jco_test.organization = '11111111-1111-4111-8111-111111111111';
-- Client roles can only see/create their currently authorized organization.
INSERT INTO public.owner_statement_deductions(
  id,organization_id,statement_id,charge_date,category,responsible_party,amount,description,support_reference
) VALUES
  ('01010101-0101-4101-8101-010101010101','11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-01','WATER','OWNER',100000,
   'Agua según acuerdo con propietario','factura-prueba-agua-10'),
  ('02020202-0202-4202-8202-020202020202','11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-01','ELECTRICITY','TENANT',80000,
   'Energía a cargo del inquilino','factura-prueba-energia-10'),
  ('03030303-0303-4303-8303-030303030303','11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-01','REPAIRS','AGENCY',35000,
   'Gasto asumido por inmobiliaria','factura-prueba-reparacion-10'),
  ('04040404-0404-4404-8404-040404040404','11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-01','COMMISSION','OWNER',150000,
   'Comisión de administración','comision-prueba-10'),
  ('05050505-0505-4505-8505-050505050505','11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-01','TAX','OWNER',25000,
   'Retención aplicable según contrato','retencion-prueba-10');

SELECT pg_temp.expect_failure($q$
  INSERT INTO public.owner_statement_deductions
    (organization_id,statement_id,charge_date,category,responsible_party,amount,description)
  VALUES ('11111111-1111-4111-8111-111111111111',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-10-01','GAS','OWNER',30000,'Factura ajena')
$q$, '23514');

-- RLS rejects using an organization which is not the signed-in tenant.
SELECT pg_temp.expect_failure($q$
  INSERT INTO public.owner_statement_deductions
    (organization_id,statement_id,charge_date,category,responsible_party,amount,description)
  VALUES ('22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-10-01','GAS','OWNER',30000,'Factura ajena')
$q$, '42501');

-- A tenant cannot forge the reviewer, payment status, or author.
SELECT pg_temp.expect_failure($q$
  INSERT INTO public.owner_statement_deductions
    (organization_id,statement_id,charge_date,category,responsible_party,amount,description,status)
  VALUES ('11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-01','GAS','OWNER',30000,
    'Estado fraudulento','APPROVED')
$q$, '23514');

SELECT pg_temp.expect_failure($q$
  INSERT INTO public.owner_statement_deductions
    (organization_id,statement_id,charge_date,category,responsible_party,amount,description,created_by)
  VALUES ('11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-01','GAS','OWNER',30000,
    'Autor falsificado','55555555-5555-4555-8555-555555555555')
$q$, '23514');

SELECT pg_temp.expect_failure($q$
  INSERT INTO public.owner_statement_deductions
    (organization_id,statement_id,charge_date,category,responsible_party,amount,description)
  VALUES ('11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-10-01','GAS','OWNER',-1,'Monto negativo')
$q$, '23514');

-- Approving a draft makes it immutable, with reviewer captured by the database.
UPDATE public.owner_statement_deductions SET status='APPROVED'
WHERE id IN ('01010101-0101-4101-8101-010101010101',
             '02020202-0202-4202-8202-020202020202',
             '03030303-0303-4303-8303-030303030303',
             '04040404-0404-4404-8404-040404040404',
             '05050505-0505-4505-8505-050505050505');

DO $assert$
DECLARE approved_count integer; owner_expense numeric; third_party_expense numeric;
BEGIN
 SELECT count(*) INTO approved_count FROM public.owner_statement_deductions
   WHERE status='APPROVED' AND approved_by = auth.uid() AND approved_at IS NOT NULL;
 IF approved_count <> 5 THEN RAISE EXCEPTION 'Wrong approval provenance or amount'; END IF;
 SELECT coalesce(sum(amount),0) INTO owner_expense FROM public.owner_statement_deductions
   WHERE status='APPROVED' AND responsible_party='OWNER' AND category NOT IN ('TAX','COMMISSION');
 SELECT coalesce(sum(amount),0) INTO third_party_expense FROM public.owner_statement_deductions
   WHERE status='APPROVED' AND responsible_party <> 'OWNER';
 IF owner_expense <> 100000 OR third_party_expense <> 115000 THEN
   RAISE EXCEPTION 'Incorrect owner-versus-tenant/agency responsibility';
 END IF;
END
$assert$;

SELECT pg_temp.expect_failure($q$
  UPDATE public.owner_statement_deductions SET status='APPROVED',amount=100
  WHERE id='01010101-0101-4101-8101-010101010101'
$q$, '23514');

SELECT pg_temp.expect_failure($q$
  UPDATE public.owner_statement_deductions SET amount=400
  WHERE id='02020202-0202-4202-8202-020202020202'
$q$, '23514');

SELECT pg_temp.expect_failure($q$
  UPDATE public.owner_statement_deductions SET status='VOIDED'
  WHERE id='01010101-0101-4101-8101-010101010101'
$q$, '23514');

UPDATE public.owner_statement_deductions
SET status='VOIDED', void_reason='La factura se anuló y se emitirá una nueva'
WHERE id='01010101-0101-4101-8101-010101010101';
DO $assert$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.owner_statement_deductions
   WHERE id='01010101-0101-4101-8101-010101010101'
      AND status='VOIDED' AND voided_at IS NOT NULL AND voided_by=auth.uid()
      AND approved_at IS NOT NULL AND approved_by=auth.uid()
 ) THEN RAISE EXCEPTION 'Void audit did not retain approval provenance'; END IF;
END
$assert$;
SELECT pg_temp.expect_failure($q$
  UPDATE public.owner_statement_deductions SET status='APPROVED'
  WHERE id='01010101-0101-4101-8101-010101010101'
$q$, '23514');

SELECT pg_temp.expect_failure($q$
  DELETE FROM public.owner_statement_deductions
  WHERE id='02020202-0202-4202-8202-020202020202'
$q$, '42501');

-- Populate B as a separately authorized member; then assert it is invisible in A.
SET jco_test.organization = '22222222-2222-4222-8222-222222222222';
INSERT INTO public.owner_statement_deductions
  (organization_id,statement_id,charge_date,category,responsible_party,amount,description)
VALUES ('22222222-2222-4222-8222-222222222222',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-10-01','GAS','OWNER',70000,'Contrato independiente');
SET jco_test.organization = '11111111-1111-4111-8111-111111111111';
DO $assert$
BEGIN
 IF (SELECT count(*) FROM public.owner_statement_deductions WHERE organization_id='22222222-2222-4222-8222-222222222222') <> 0
 THEN RAISE EXCEPTION 'Tenant B ledger exposed in tenant A'; END IF;
END
$assert$;

-- The parent statement lock/check prevents new charges on finalized statements.
RESET ROLE;
UPDATE public.owner_statements SET status='GENERATED' WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
SET ROLE authenticated;
SELECT pg_temp.expect_failure($q$
  INSERT INTO public.owner_statement_deductions
    (organization_id,statement_id,charge_date,category,responsible_party,amount,description)
  VALUES ('11111111-1111-4111-8111-111111111111',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','2026-10-01','OTHER','OWNER',15000,
    'Después del cierre')
$q$, '23514');

RESET ROLE;
SELECT pg_temp.expect_failure($q$
 DELETE FROM public.owner_statements WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
$q$, '23503');

DO $assert$
BEGIN
 IF (SELECT count(*) FROM pg_policies
   WHERE schemaname='public' AND tablename='owner_statement_deductions') <> 3
 THEN RAISE EXCEPTION 'Missing RLS policies'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policies
   WHERE schemaname='public' AND tablename='owner_statement_deductions'
     AND cmd='DELETE')
 THEN RAISE EXCEPTION 'Financial ledger DELETE policy unexpectedly exists'; END IF;
END
$assert$;
