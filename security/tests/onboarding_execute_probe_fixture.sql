-- Disposable PostgreSQL only. Minimal EXECUTE privilege fixture.
-- This does NOT reproduce the complete production onboarding transaction.
CREATE SCHEMA IF NOT EXISTS auth;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  CREATE ROLE authenticated NOLOGIN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  CREATE ROLE anon NOLOGIN;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.onboarding_execute_probe(
 org_name text, org_slug text, org_country_code text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 RETURN org_slug;
END $$;
REVOKE ALL ON FUNCTION public.onboarding_execute_probe(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.onboarding_execute_probe(text,text,text) TO authenticated;
