-- REVIEW CANDIDATE ONLY. NOT a Supabase migration; DO NOT apply to production.
-- PostgreSQL 17: MAINTAIN permits VACUUM/ANALYZE/REINDEX/CLUSTER/REFRESH,
-- none of which are needed by Supabase anon/authenticated API clients.
-- This deliberately does NOT alter CRUD, RLS, service_role, storage or auth.
-- Audit #203/#104: existing and future public tables owned by postgres/supabase_admin.
BEGIN;
REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE MAINTAIN ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE MAINTAIN ON TABLES FROM anon, authenticated;
COMMIT;
