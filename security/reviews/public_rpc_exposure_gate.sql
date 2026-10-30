-- INMOJCO - read-only privileged RPC exposure regression gate.
-- Use with psql -v ON_ERROR_STOP=1. No production changes.
-- Tested against live project metadata on 2026-10-30.
DO $gate$
DECLARE
  n_unknown int;
  n_unsafe_path int;
  n_implicit_public int;
  n_allowed int;
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'required Supabase API roles not available';
  END IF;
  IF has_schema_privilege('anon','public','CREATE') OR
     has_schema_privilege('authenticated','public','CREATE') THEN
    RAISE EXCEPTION 'API roles must never CREATE objects in public schema';
  END IF;

  SELECT count(*) INTO n_unknown
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
    AND (p.proname, pg_catalog.oidvectortypes(p.proargtypes)) NOT IN (
      ('get_public_property_intake_site','text'),
      ('submit_property_consignment','text, uuid, jsonb'),
      ('submit_public_website_lead','text, text, text, text, text, text, boolean, text'),
      ('tenant_public_catalog','text')
    );
  IF n_unknown <> 0 THEN
    RAISE EXCEPTION 'unauthorized anonymous SECURITY DEFINER RPC: %',n_unknown;
  END IF;

  SELECT count(*) INTO n_implicit_public
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND EXISTS(
      SELECT 1 FROM pg_catalog.aclexplode(
        coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
      ) acl
      WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
    );
  IF n_implicit_public <> 0 THEN
    RAISE EXCEPTION 'SECURITY DEFINER functions must not inherit EXECUTE from PUBLIC: %',n_implicit_public;
  END IF;

  SELECT count(*) INTO n_unsafe_path
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND NOT EXISTS (
      SELECT 1 FROM unnest(coalesce(p.proconfig,'{}'::text[])) cfg
      WHERE cfg LIKE 'search_path=%'
    );
  IF n_unsafe_path <> 0 THEN
    RAISE EXCEPTION 'unfixed search_path in privileged public functions: %',n_unsafe_path;
  END IF;

  SELECT count(*) INTO n_allowed
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE');
  IF n_allowed <> 4 THEN
    RAISE EXCEPTION 'unexpected anonymous privileged function count: %',n_allowed;
  END IF;

  RAISE NOTICE 'RPC privilege gate PASS: 4 explicit public forms/catalogs; zero implicit PUBLIC grants, unsafe paths or schema CREATE grants';
END
$gate$;
