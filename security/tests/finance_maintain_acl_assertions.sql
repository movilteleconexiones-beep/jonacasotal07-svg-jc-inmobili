-- Run AFTER security/candidates/revoke_authenticated_finance_maintain.sql
-- in the disposable jco_finance_maintain_acl_test PostgreSQL 17 database.
DO $assert$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['leases','rent_payments','owner_statements'] LOOP
    IF has_table_privilege('authenticated',format('public.%I',tab),'MAINTAIN') THEN
      RAISE EXCEPTION 'Authenticated may still maintain %',tab;
    END IF;
    IF NOT has_table_privilege('service_role',format('public.%I',tab),'MAINTAIN') THEN
      RAISE EXCEPTION 'Service role MAINTAIN disappeared from %',tab;
    END IF;
    IF NOT has_table_privilege('authenticated',format('public.%I',tab),'SELECT') THEN
      RAISE EXCEPTION 'Normal authenticated read disappeared from %',tab;
    END IF;
    IF has_table_privilege('anon',format('public.%I',tab),'SELECT') THEN
      RAISE EXCEPTION 'Anonymous read was accidentally granted on %',tab;
    END IF;
    IF has_table_privilege('authenticated',format('public.%I',tab),'DELETE')
       OR has_table_privilege('authenticated',format('public.%I',tab),'TRUNCATE') THEN
      RAISE EXCEPTION 'Dangerous write grant appeared on %',tab;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated','public.leases','INSERT')
     OR NOT has_table_privilege('authenticated','public.leases','UPDATE')
     OR has_table_privilege('authenticated','public.rent_payments','UPDATE')
     OR has_table_privilege('authenticated','public.owner_statements','INSERT') THEN
    RAISE EXCEPTION 'Normal business grants modified outside intended MAINTAIN-only revoke';
  END IF;
END;
$assert$;

-- Prove app-level SELECT/INSERT/UPDATE still work after the narrow revoke.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT id,monthly_rent FROM public.leases WHERE id=1;
INSERT INTO public.leases(id,monthly_rent) VALUES(2,1800000);
UPDATE public.leases SET monthly_rent=1900000 WHERE id=2;
SELECT id,monthly_rent FROM public.leases WHERE id=2;
SELECT id,expected_amount FROM public.rent_payments WHERE id=1;
SELECT id,net_amount FROM public.owner_statements WHERE id=1;
ROLLBACK;
-- Synthetic data remain untouched after the permission smoke test.
DO $assert$
BEGIN
  IF (SELECT count(*) FROM public.leases)<>1
     OR (SELECT monthly_rent FROM public.leases WHERE id=1)<>1700000 THEN
    RAISE EXCEPTION 'CI business data mutated by permission test';
  END IF;
END;
$assert$;
