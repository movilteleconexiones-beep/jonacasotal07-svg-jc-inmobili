-- Isolated PostgreSQL 17 CI database, not a customer database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END;
$$;
CREATE TABLE public.api_role_security_fixture (
  id int PRIMARY KEY,
  title text NOT NULL
);
CREATE TABLE public.api_role_security_fixture_other (
  id int PRIMARY KEY
);
INSERT INTO public.api_role_security_fixture VALUES (1,'Retained row');
GRANT ALL ON public.api_role_security_fixture,public.api_role_security_fixture_other
  TO anon,authenticated;
ALTER TABLE public.api_role_security_fixture ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_visible ON public.api_role_security_fixture
  FOR SELECT TO anon,authenticated USING (true);
DO $$
BEGIN
 IF NOT has_table_privilege('anon','public.api_role_security_fixture','TRUNCATE')
    OR NOT has_table_privilege('authenticated','public.api_role_security_fixture','TRUNCATE')
 THEN RAISE EXCEPTION 'Fixture must begin with excessive table grants'; END IF;
END;
$$;
