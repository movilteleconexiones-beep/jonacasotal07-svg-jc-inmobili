\set ON_ERROR_STOP on
-- #205: PostgreSQL 17 disposable fixture, no production keys or real data.
DO $roles$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon')
    THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')
    THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role')
    THEN CREATE ROLE service_role NOLOGIN; END IF;
END $roles$;

-- Emulate the stricter Data API defaults for *new* tables.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE public.jco_205_api_grant_fixture(
  organization_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  value text NOT NULL
);
ALTER TABLE public.jco_205_api_grant_fixture ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.jco_205_api_grant_fixture
  FROM PUBLIC,anon,authenticated,service_role;

DO $negative$ BEGIN
  IF has_table_privilege('anon','public.jco_205_api_grant_fixture','SELECT') OR
     has_table_privilege('authenticated','public.jco_205_api_grant_fixture','INSERT')
  THEN RAISE EXCEPTION 'New public table unexpectedly exposed by default'; END IF;
END $negative$;

-- A new feature must request only the operations it needs.
GRANT SELECT,INSERT ON TABLE public.jco_205_api_grant_fixture TO authenticated;
GRANT SELECT ON TABLE public.jco_205_api_grant_fixture TO service_role;
-- Authenticated is not authorization. The fixture denies ALL rows.
CREATE POLICY jco_205_no_data_exposure ON public.jco_205_api_grant_fixture
  FOR SELECT TO authenticated USING (false);
INSERT INTO public.jco_205_api_grant_fixture VALUES(
  '11111111-1111-4111-8111-111111111111'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  'SYNTHETIC_ONLY'
);
DO $privileges$ BEGIN
  IF NOT has_table_privilege('authenticated','public.jco_205_api_grant_fixture','SELECT') OR
     NOT has_table_privilege('authenticated','public.jco_205_api_grant_fixture','INSERT') OR
     has_table_privilege('authenticated','public.jco_205_api_grant_fixture','DELETE') OR
     has_table_privilege('anon','public.jco_205_api_grant_fixture','SELECT') OR
     has_table_privilege('service_role','public.jco_205_api_grant_fixture','UPDATE') OR
     NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.jco_205_api_grant_fixture'::regclass)
  THEN RAISE EXCEPTION 'Explicit new-table grants or RLS are incorrect'; END IF;
END $privileges$;
SET ROLE authenticated;
SELECT count(*) AS allowed_rows_must_be_zero
  FROM public.jco_205_api_grant_fixture;
RESET ROLE;
SELECT 'PASS: default-deny table requires explicit privileges; RLS remains mandatory' AS result;
