-- INMOJCO #104/#203 — REVIEW ONLY. NOT A SUPABASE MIGRATION.
-- Supabase postgres is not normally a member of supabase_admin.
-- Requires legitimately authorized current_user=supabase_admin, no bypass.
-- Never apply to production while #104 is NO-GO.
BEGIN;
DO $preflight$
BEGIN
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION 'MAINTAIN phase-2 blocked: must execute AS supabase_admin (actual: %)',current_user;
  END IF;
END
$preflight$;
-- Prevent MAINTAIN on all future supabase_admin-created public tables.
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE MAINTAIN ON TABLES FROM anon,authenticated;
-- Also clean tables created BETWEEN the first and second phases.
-- Do not try REVOKE ON ALL TABLES because postgres owns other relations.
DO $owned_tables$
DECLARE obj record;
BEGIN
 FOR obj IN
   SELECT n.nspname AS ns,c.relname AS rel
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
     AND c.relowner='supabase_admin'::regrole
 LOOP
   EXECUTE format('REVOKE MAINTAIN ON TABLE %I.%I FROM anon, authenticated',obj.ns,obj.rel);
 END LOOP;
END
$owned_tables$;
COMMIT;
