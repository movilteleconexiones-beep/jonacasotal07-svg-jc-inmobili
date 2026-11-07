-- INMOJCO G08 / #203 / #252
-- PostgreSQL 17: public MAINTAIN privilege revocation for API roles.
-- A/B test on live schema executed under BEGIN/ROLLBACK (2026-11-07).
-- Scope: public objects owned by postgres; no privilege for service_role is changed.
DO $preflight$
BEGIN
 IF current_user <> 'postgres' THEN
  RAISE EXCEPTION 'Expected postgres migration executor, got %',current_user;
 END IF;
 IF EXISTS (
  SELECT 1 FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
   AND c.relowner<>'postgres'::regrole
 ) THEN
  RAISE EXCEPTION 'Unexpected public object owner: halt before privilege changes';
 END IF;
END
$preflight$;

-- Revoke first from future postgres-created public tables.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
 REVOKE MAINTAIN ON TABLES FROM anon, authenticated;

-- Existing public relations have been verified as all owned by postgres.
REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

DO $postflight$
DECLARE v_count int; v_service int; v_anon int; v_auth int;
BEGIN
 SELECT count(*),
 count(*) FILTER(WHERE has_table_privilege('service_role',c.oid,'MAINTAIN')),
 count(*) FILTER(WHERE has_table_privilege('anon',c.oid,'MAINTAIN')),
 count(*) FILTER(WHERE has_table_privilege('authenticated',c.oid,'MAINTAIN'))
 INTO v_count,v_service,v_anon,v_auth
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p');
 IF v_count<>v_service OR v_anon<>0 OR v_auth<>0 THEN
  RAISE EXCEPTION 'MAINTAIN postflight failed: tables %, service %, anon %, authenticated %',
   v_count,v_service,v_anon,v_auth;
 END IF;
 IF EXISTS(
  SELECT 1 FROM pg_default_acl d
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE d.defaclnamespace='public'::regnamespace
    AND d.defaclobjtype='r'
    AND d.defaclrole='postgres'::regrole
    AND a.grantee IN ('anon'::regrole,'authenticated'::regrole)
    AND a.privilege_type='MAINTAIN'
 ) THEN RAISE EXCEPTION 'Unexpected postgres default MAINTAIN grant'; END IF;
 IF NOT has_table_privilege('authenticated','public.contacts','SELECT')
 OR NOT has_table_privilege('authenticated','public.leases','SELECT')
 OR NOT has_table_privilege('authenticated','public.rent_payments','SELECT')
 OR NOT has_table_privilege('authenticated','public.owner_statements','SELECT')
 THEN RAISE EXCEPTION 'Commercial SELECT grants unexpectedly changed'; END IF;
END
$postflight$;