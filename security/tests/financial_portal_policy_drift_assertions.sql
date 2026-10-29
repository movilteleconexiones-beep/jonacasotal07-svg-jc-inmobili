-- Guard against reintroducing staff-only restrictive policies that silently
-- hide PERSONAL financial documents from linked owners and tenants.
-- In CI the fixture is first regressed intentionally, then repaired.
DO $assert$
DECLARE n integer;
BEGIN
  SELECT COUNT(*) INTO n
  FROM pg_policies
  WHERE schemaname='public' AND cmd='SELECT'
    AND permissive='RESTRICTIVE'
    AND roles @> ARRAY['authenticated']::name[]
    AND qual LIKE '%portal_access_links%'
    AND qual LIKE '%has_org_permission%'
    AND (tablename,policyname) IN (
      ('leases','leases_financial_view'),
      ('rent_payments','rent_payments_financial_view'),
      ('owner_statements','owner_statement_financial_view')
    );
  IF n<>3 THEN
    RAISE EXCEPTION 'Finance portal RLS drift: expected 3 personal-link-aware restrictive policies, got %',n;
  END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='owner_statements' AND policyname='owner_statement_financial_view'
    AND qual LIKE '%issued_at IS NOT NULL%'
    AND qual LIKE '%owner_id%')
  THEN RAISE EXCEPTION 'Owner financial SELECT must require issued personal statement'; END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='leases' AND policyname='leases_financial_view'
    AND qual LIKE '%tenant_id%' AND qual LIKE '%owner_id%')
  THEN RAISE EXCEPTION 'Lease finance SELECT must require personal tenant/owner link'; END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='rent_payments' AND policyname='rent_payments_financial_view'
    AND qual LIKE '%lease_id%' AND qual LIKE '%tenant_id%' AND qual LIKE '%owner_id%')
  THEN RAISE EXCEPTION 'Rent finance SELECT must require personal lease link'; END IF;
END $assert$;