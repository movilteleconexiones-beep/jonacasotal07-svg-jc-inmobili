-- Disposable PostgreSQL 17+ CI database only: never apply to live Supabase.
DO $roles$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END;
$roles$;
CREATE TABLE public.leases(id int PRIMARY KEY,monthly_rent numeric NOT NULL);
CREATE TABLE public.rent_payments(id int PRIMARY KEY,expected_amount numeric NOT NULL);
CREATE TABLE public.owner_statements(id int PRIMARY KEY,net_amount numeric NOT NULL);
REVOKE ALL ON TABLE public.leases,public.rent_payments,public.owner_statements
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,MAINTAIN ON TABLE public.leases TO authenticated;
GRANT SELECT,MAINTAIN ON TABLE public.rent_payments,public.owner_statements TO authenticated;
GRANT ALL ON TABLE public.leases,public.rent_payments,public.owner_statements TO service_role;
INSERT INTO public.leases VALUES(1,1700000);
INSERT INTO public.rent_payments VALUES(1,1700000);
INSERT INTO public.owner_statements VALUES(1,1500000);
DO $assert$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['leases','rent_payments','owner_statements'] LOOP
    IF NOT has_table_privilege('authenticated',format('public.%I',tab),'MAINTAIN') THEN
      RAISE EXCEPTION 'Bad setup: authenticated MAINTAIN not granted on %',tab;
    END IF;
    IF has_table_privilege('anon',format('public.%I',tab),'SELECT') THEN
      RAISE EXCEPTION 'Bad setup: anon can read %',tab;
    END IF;
  END LOOP;
END;
$assert$;
