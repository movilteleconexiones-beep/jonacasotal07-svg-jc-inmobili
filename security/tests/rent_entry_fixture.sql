-- PostgreSQL 17 isolated fixture. IDs are artificial and unrelated to production.
DO $roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('jco_test.actor',true),'')::uuid
$$;

CREATE FUNCTION public.has_org_permission(org uuid, permission text)
RETURNS boolean LANGUAGE sql STABLE
AS $$
  SELECT org=nullif(current_setting('jco_test.organization',true),'')::uuid AND
    permission IN ('rent_payments.view','rent_payments.create',
                   'owner_statements.view','owner_statements.create')
$$;
GRANT USAGE ON SCHEMA auth,public TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_permission(uuid,text) TO authenticated;

CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.properties(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
CREATE TABLE public.contacts(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
CREATE TABLE public.property_owners(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
CREATE TABLE public.leases (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 property_id uuid NOT NULL,
 tenant_id uuid,
 owner_id uuid,
 contract_number text,
 monthly_rent numeric NOT NULL,
 start_date date NOT NULL,
 end_date date,
 status text NOT NULL
);
CREATE TABLE public.rent_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 lease_id uuid NOT NULL,
 period_month date NOT NULL,
 expected_amount numeric NOT NULL,
 paid_amount numeric NOT NULL DEFAULT 0,
 paid_at timestamptz,
 status text NOT NULL DEFAULT 'PENDING'
);
CREATE TABLE public.owner_statements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 lease_id uuid NOT NULL,
 owner_id uuid,
 period_month date NOT NULL,
 gross_income numeric NOT NULL DEFAULT 0,
 commission_amount numeric NOT NULL DEFAULT 0,
 tax_amount numeric NOT NULL DEFAULT 0,
 other_deductions numeric NOT NULL DEFAULT 0,
 net_amount numeric NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'DRAFT'
);

ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_leases_all ON public.leases FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY legacy_rent_all ON public.rent_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY legacy_statements_all ON public.owner_statements FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.leases,public.rent_payments,
 public.owner_statements,public.property_owners TO authenticated;

INSERT INTO public.organizations VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');

INSERT INTO public.properties VALUES
 ('11111111-2222-4333-8444-555555555555','11111111-1111-4111-8111-111111111111'),
 ('22222222-3333-4444-8555-666666666666','22222222-2222-4222-8222-222222222222');
INSERT INTO public.contacts VALUES
 ('33333333-4444-4555-8666-777777777777','11111111-1111-4111-8111-111111111111'),
 ('44444444-5555-4666-8777-888888888888','22222222-2222-4222-8222-222222222222');
INSERT INTO public.property_owners(id,organization_id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222');

INSERT INTO public.leases(id,organization_id,property_id,tenant_id,owner_id,contract_number,monthly_rent,start_date,end_date,status) VALUES
 ('33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  '11111111-2222-4333-8444-555555555555',
  '33333333-4444-4555-8666-777777777777',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'PRUEBA-A',1600000,'2026-09-15','2027-09-14','ACTIVE'),
 ('44444444-4444-4444-8444-444444444444',
  '22222222-2222-4222-8222-222222222222',
  '22222222-3333-4444-8555-666666666666',
  '44444444-5555-4666-8777-888888888888',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'PRUEBA-B',900000,'2026-09-01',NULL,'ACTIVE'),
 ('55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  '11111111-2222-4333-8444-555555555555',
  '33333333-4444-4555-8666-777777777777',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'BORRADOR-A',300000,'2026-09-01',NULL,'DRAFT');
