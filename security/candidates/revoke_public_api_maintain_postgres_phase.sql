-- INMOJCO #104/#203 — REVIEW ONLY. NOT A SUPABASE MIGRATION.
-- This phase is intentionally INCOMPLETE until the matching
-- supabase_admin default privileges phase has succeeded.
-- Never apply to production while #104 is NO-GO. No customer data access.
-- PostgreSQL 17: RLS does NOT control table MAINTAIN privileges.
BEGIN;
DO $preflight$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'MAINTAIN phase-1 blocked: must execute AS postgres (actual: %)',current_user;
  END IF;
  IF EXISTS(
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relowner <> 'postgres'::regrole
  ) THEN
    RAISE EXCEPTION 'MAINTAIN phase-1 blocked: non-postgres table owner requires separate review';
  END IF;
END
$preflight$;
-- Existing public tables; does not change CRUD, RLS, or service_role.
REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon,authenticated;
-- Future tables created under postgres; supabase_admin remains outstanding.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE MAINTAIN ON TABLES FROM anon,authenticated;
COMMIT;
