-- REVIEW CANDIDATE ONLY. NOT a Supabase migration; DO NOT apply to production.
-- PostgreSQL 17: MAINTAIN permits VACUUM/ANALYZE/REINDEX/CLUSTER/REFRESH,
-- none of which are needed by Supabase anon/authenticated API clients.
-- This deliberately does NOT alter CRUD, RLS, service_role, storage or auth.
-- Audit #203/#104: existing and future public tables owned by postgres/supabase_admin.
BEGIN;
-- ALTER DEFAULT PRIVILEGES FOR ROLE requires membership in EACH owner role.
-- A session as supabase_admin alone is NOT authorized for postgres defaults.
-- Fail before any REVOKE; this necessary check is not proof of table ownership.
DO $executor_guard$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
     AND (
       (current_user <> 'postgres'
        AND NOT pg_has_role(current_user, 'postgres', 'MEMBER'))
       OR
       (current_user <> 'supabase_admin'
        AND NOT pg_has_role(current_user, 'supabase_admin', 'MEMBER'))
     ) THEN
    RAISE EXCEPTION 'MAINTAIN candidate blocked: executor % must be a superuser or member of both postgres and supabase_admin', current_user;
  END IF;
END
$executor_guard$;
REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE MAINTAIN ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE MAINTAIN ON TABLES FROM anon, authenticated;
COMMIT;
