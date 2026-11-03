-- Disposable PostgreSQL 17 only. Tiny fake CRM schema reproducing live FK/RLS shape.
DO $r$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  CREATE ROLE authenticated NOLOGIN;
 END IF;
END $r$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO authenticated;
CREATE SCHEMA private;
CREATE TABLE public.organizations (id uuid PRIMARY KEY);
CREATE TABLE public.contacts (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 UNIQUE(organization_id,id)
);
CREATE TABLE public.properties (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 UNIQUE(organization_id,id)
);
CREATE TABLE public.leads (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id),
 contact_id uuid NOT NULL REFERENCES public.contacts(id),
 property_id uuid REFERENCES public.properties(id)
);
CREATE TABLE public.property_consignments (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id),
 contact_id uuid REFERENCES public.contacts(id),
 lead_id uuid REFERENCES public.leads(id),
 property_id uuid REFERENCES public.properties(id)
);
INSERT INTO public.organizations VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.contacts VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111');
INSERT INTO public.properties VALUES
 ('aaaaaaaa-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222');
INSERT INTO public.leads VALUES
 ('aaaaaaaa-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001'),
 ('bbbbbbbb-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-0000-4000-8000-000000000002');
INSERT INTO public.property_consignments VALUES
 ('aaaaaaaa-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-1111-4111-8111-111111111111',
  'aaaaaaaa-0000-4000-8000-000000000001');

-- An authenticated staff member has normal permission to insert a lead only for
-- its own agency. Existing single-column FKs still accept a known B contact ID.
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_read_tenant ON public.contacts FOR SELECT TO authenticated
 USING(organization_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY lead_access_tenant ON public.leads TO authenticated
 USING(organization_id=current_setting('app.tenant_id',true)::uuid)
 WITH CHECK(organization_id=current_setting('app.tenant_id',true)::uuid);
GRANT SELECT ON public.contacts TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.leads TO authenticated;
