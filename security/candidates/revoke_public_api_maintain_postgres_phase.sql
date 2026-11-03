-- INMOJCO #104/#203 — REVIEW ONLY. NOT A SUPABASE MIGRATION.
-- First AND final owner-specific pass; does not touch objects of other owners.
-- Never apply to production while #104 is NO-GO.
BEGIN;
DO $preflight$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'MAINTAIN phase-1 blocked: must execute AS postgres (actual: %)',current_user;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
      AND c.relowner NOT IN ('postgres'::regrole,'supabase_admin'::regrole)
  ) THEN
    RAISE EXCEPTION 'MAINTAIN phase-1 blocked: unexpected public object owner';
  END IF;
END
$preflight$;
-- First prevent future postgres-owned table MAINTAIN grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE MAINTAIN ON TABLES FROM anon,authenticated;
-- PostgreSQL owners can revoke grants on their OWN objects only.
-- Never use REVOKE ON ALL TABLES here: supabase_admin may own other objects.
DO $owned_tables$
DECLARE obj record;
BEGIN
 FOR obj IN
   SELECT n.nspname AS ns,c.relname AS rel
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
     AND c.relowner='postgres'::regrole
 LOOP
   EXECUTE format('REVOKE MAINTAIN ON TABLE %I.%I FROM anon, authenticated',obj.ns,obj.rel);
 END LOOP;
END
$owned_tables$;
COMMIT;
