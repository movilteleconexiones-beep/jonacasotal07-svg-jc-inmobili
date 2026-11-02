-- INMOJCO security candidate #104 — NOT A PRODUCTION MIGRATION.
-- PostgreSQL 17+ only. Validate in disposable CI and isolated Supabase staging
-- before considering a versioned migration, after reconciling the migration
-- ledger. Never run supabase db push/repair based on this file.
--
-- READ-ONLY production pg_catalog (2026-11-02) confirmed that authenticated
-- holds MAINTAIN, directly granted by postgres, on exactly these 3 tables:
-- leases, rent_payments, owner_statements.
-- MAINTAIN allows VACUUM/ANALYZE/REINDEX/CLUSTER/LOCK TABLE and is NOT
-- required for browser clients to SELECT/INSERT/UPDATE under RLS.
-- Revoke only MAINTAIN. Preserve business grants, service_role and RLS.
BEGIN;
REVOKE MAINTAIN ON TABLE
  public.leases,
  public.rent_payments,
  public.owner_statements
FROM authenticated;

-- Fail closed: inherited PUBLIC or other role membership cannot silently
-- preserve the effective privilege. A failed assertion rolls back the revoke.
DO $assert$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['leases','rent_payments','owner_statements'] LOOP
    IF has_table_privilege('authenticated',format('public.%I',tab),'MAINTAIN') THEN
      RAISE EXCEPTION 'MAINTAIN still granted to authenticated on %',tab USING ERRCODE='42501';
    END IF;
    IF NOT has_table_privilege('service_role',format('public.%I',tab),'MAINTAIN') THEN
      RAISE EXCEPTION 'Service maintenance permission unexpectedly absent on %',tab USING ERRCODE='42501';
    END IF;
  END LOOP;
END;
$assert$;
COMMIT;
