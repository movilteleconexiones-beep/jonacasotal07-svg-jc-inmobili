-- After grant hardening, safe CRUD operations and RLS remain unchanged.
DO $$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_table_privilege(role_name,'public.api_role_security_fixture','TRUNCATE')
    OR has_table_privilege(role_name,'public.api_role_security_fixture','TRIGGER')
    OR has_table_privilege(role_name,'public.api_role_security_fixture','REFERENCES')
    OR has_table_privilege(role_name,'public.api_role_security_fixture_other','TRUNCATE')
  THEN RAISE EXCEPTION 'Unsafe privilege remains granted to %',role_name; END IF;
  IF NOT has_table_privilege(role_name,'public.api_role_security_fixture','SELECT')
    OR NOT has_table_privilege(role_name,'public.api_role_security_fixture','INSERT')
    OR NOT has_table_privilege(role_name,'public.api_role_security_fixture','UPDATE')
    OR NOT has_table_privilege(role_name,'public.api_role_security_fixture','DELETE')
  THEN RAISE EXCEPTION 'CRUD privilege changed for %',role_name; END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.api_role_security_fixture)<>1 THEN
  RAISE EXCEPTION 'Migration must not change records'; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_policies WHERE schemaname='public'
     AND tablename='api_role_security_fixture' AND policyname='fixture_visible'
 ) THEN RAISE EXCEPTION 'Migration must preserve RLS'; END IF;
END;
$$;

-- Idempotent: a second run never recreates broad grants.
\i supabase/migrations/20261012235500_restrict_excessive_api_role_table_grants.sql
DO $$
BEGIN
 IF has_table_privilege('anon','public.api_role_security_fixture','TRUNCATE') THEN
  RAISE EXCEPTION 'Idempotence failed'; END IF;
END;
$$;
