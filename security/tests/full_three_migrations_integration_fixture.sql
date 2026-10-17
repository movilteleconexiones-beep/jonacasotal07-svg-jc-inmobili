-- PostgreSQL 17 fake-data fixture AFTER:
-- external_portals_staff_seats_fixture.sql,
-- 20261015092500, 20261015093000, 20261015114500,
-- private_properties_tenant_guard_fixture.sql,
-- 20261015195500 and its privacy assertions.
-- NEVER execute on Supabase production.
DO $fixture$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN
   CREATE ROLE service_role NOLOGIN BYPASSRLS;
 END IF;
END $fixture$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

-- Production has organizations_select_member; the generic external/staff
-- fixture deliberately omitted it. Model the real organization RLS here:
-- Storage logo policies query organizations under the authenticated actor.
CREATE POLICY organizations_select_member ON public.organizations
 FOR SELECT TO authenticated USING (public.is_org_member(id));

ALTER TABLE public.organizations ADD COLUMN slug text;
UPDATE public.organizations SET slug=CASE id
 WHEN '22222222-2222-4222-8222-222222222222' THEN 'tenant-a'
 WHEN 'abababab-abab-4bab-8bab-abababababab' THEN 'tenant-b'
 ELSE NULL END;

ALTER TABLE public.organization_settings
 ADD COLUMN enable_public_website boolean NOT NULL DEFAULT true;

ALTER TABLE public.properties
 ADD COLUMN code text,
 ADD COLUMN title text,
 ADD COLUMN operation_type text,
 ADD COLUMN property_type text,
 ADD COLUMN status text,
 ADD COLUMN price numeric(16,2),
 ADD COLUMN currency text,
 ADD COLUMN country text,
 ADD COLUMN state text,
 ADD COLUMN city text,
 ADD COLUMN neighborhood text,
 ADD COLUMN bedrooms numeric(5,2),
 ADD COLUMN bathrooms numeric(5,2),
 ADD COLUMN parking_spaces integer,
 ADD COLUMN built_area numeric(12,2),
 ADD COLUMN lot_area numeric(12,2),
 ADD COLUMN featured boolean NOT NULL DEFAULT false,
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

UPDATE public.properties
 SET code=CASE WHEN organization_id='22222222-2222-4222-8222-222222222222'
    THEN 'A-0001' ELSE 'B-0001' END,
 title=CASE WHEN organization_id='22222222-2222-4222-8222-222222222222'
    THEN 'Apartamento de A' ELSE 'Apartamento de B' END,
 operation_type='RENT', property_type='APARTMENT',
 status='AVAILABLE',price=1800000,currency='COP',country='CO',
 state='Antioquia',city='Medellín',neighborhood='Sector comercial',
 bedrooms=2,bathrooms=1,parking_spaces=1,built_area=60,
 featured=true;

CREATE TABLE private.property_intake_sites(
 slug text PRIMARY KEY,
 organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id),
 enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE private.property_intake_sites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.property_intake_sites FROM PUBLIC,anon,authenticated;
INSERT INTO private.property_intake_sites(slug,organization_id,enabled)
VALUES('tenant-a','22222222-2222-4222-8222-222222222222',true),
      ('tenant-b','abababab-abab-4bab-8bab-abababababab',true);

CREATE SCHEMA storage;
CREATE TABLE storage.buckets(
 id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,
 allowed_mime_types text[]
);
CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated,anon,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
GRANT ALL ON storage.buckets TO authenticated,service_role;
