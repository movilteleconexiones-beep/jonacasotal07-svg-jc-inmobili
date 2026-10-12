-- Run after the rent-entry fixtures and all staged financial migrations.
-- This specifically exercises the permissive legacy ALL policies AND our new
-- restrictive permission gates, plus composite tenant foreign keys.
CREATE FUNCTION pg_temp.fail_with(statement text,sqlstate_expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN actual:=SQLSTATE;
 END;
 IF actual IS DISTINCT FROM sqlstate_expected THEN
  RAISE EXCEPTION 'Expected % but got %: %',
    sqlstate_expected,coalesce(actual,'SUCCESS'),statement;
 END IF;
END
$$;

DO $assert$
BEGIN
 IF has_table_privilege('authenticated','public.owner_statements','UPDATE') OR
    has_table_privilege('authenticated','public.owner_statements','INSERT') OR
    has_table_privilege('authenticated','public.owner_statements','DELETE') OR
    has_table_privilege('authenticated','public.leases','DELETE') THEN
  RAISE EXCEPTION 'Unsafe direct accounting write or lease deletion privilege remains';
 END IF;
 IF (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='leases'
      AND policyname LIKE 'leases_financial_%' AND permissive='RESTRICTIVE')<>3 THEN
    RAISE EXCEPTION 'All three restrictive leases permissions were not installed';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies
  WHERE schemaname='public' AND tablename='owner_statements'
    AND policyname='owner_statement_financial_view' AND permissive='RESTRICTIVE') THEN
  RAISE EXCEPTION 'Missing restrictive owner statement permission';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint
  WHERE conrelid='public.leases'::regclass AND conname='leases_tenant_same_tenant_fk')
 THEN RAISE EXCEPTION 'Missing lease tenant-bound contact FK'; END IF;
END
$assert$;

SET ROLE authenticated;
SET jco_test.actor='99999999-9999-4999-8999-999999999999';
SET jco_test.organization='11111111-1111-4111-8111-111111111111';

-- Tenant A cannot see Tenant B's lease, despite the old permissive ALL policy.
DO $assert$
BEGIN
 IF (SELECT count(*) FROM public.leases
    WHERE id='44444444-4444-4444-8444-444444444444')<>0 THEN
  RAISE EXCEPTION 'Cross-organization lease was exposed'; END IF;
END
$assert$;

-- Tenant A can insert an A lease, but only with A's contact/property/owner.
SELECT pg_temp.fail_with($deny$
 INSERT INTO public.leases (id,organization_id,property_id,tenant_id,owner_id,contract_number,monthly_rent,start_date,status)
 VALUES ('12121212-1212-4212-8212-121212121212',
 '11111111-1111-4111-8111-111111111111',
 '11111111-2222-4333-8444-555555555555',
 '44444444-5555-4666-8777-888888888888',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'FOREIGN-INQUILINO',10000,'2026-10-01','DRAFT')
$deny$,'23503');

SELECT pg_temp.fail_with($deny$
 INSERT INTO public.leases (id,organization_id,property_id,tenant_id,owner_id,contract_number,monthly_rent,start_date,status)
 VALUES ('12121212-1212-4212-8212-121212121212',
 '11111111-1111-4111-8111-111111111111',
 '22222222-3333-4444-8555-666666666666',
 '33333333-4444-4555-8666-777777777777',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'FOREIGN-PROPERTY',10000,'2026-10-01','DRAFT')
$deny$,'23503');

SELECT pg_temp.fail_with($deny$
 INSERT INTO public.leases (id,organization_id,property_id,tenant_id,owner_id,contract_number,monthly_rent,start_date,status)
 VALUES ('12121212-1212-4212-8212-121212121212',
 '11111111-1111-4111-8111-111111111111',
 '11111111-2222-4333-8444-555555555555',
 '33333333-4444-4555-8666-777777777777',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'FOREIGN-OWNER',10000,'2026-10-01','DRAFT')
$deny$,'23503');

-- Aggregates must never be editable directly, even if a broad legacy ALL
-- policy would have allowed an active org member to forge a paid status.
SELECT pg_temp.fail_with($deny$
 UPDATE public.owner_statements SET status='PAID',net_amount=1
 WHERE organization_id='11111111-1111-4111-8111-111111111111'
$deny$,'42501');

SELECT pg_temp.fail_with($deny$
 DELETE FROM public.leases
 WHERE organization_id='11111111-1111-4111-8111-111111111111'
$deny$,'42501');

RESET ROLE;

-- The existing stored owner statement and receipts remain intact.
DO $assert$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.owner_statements
  WHERE net_amount=1290000 AND gross_income=1600000 AND status='DRAFT') THEN
  RAISE EXCEPTION 'Financial row changed unexpectedly'; END IF;
 IF (SELECT count(*) FROM public.rent_receipts)<>2 THEN
  RAISE EXCEPTION 'Receipt audit rows changed unexpectedly'; END IF;
END
$assert$;
