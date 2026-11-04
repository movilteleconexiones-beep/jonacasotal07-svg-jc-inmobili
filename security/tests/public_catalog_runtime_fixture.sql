-- CI only: synthetic tenants and properties. Never run this fixture on Supabase.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $roles$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon,authenticated;
CREATE SCHEMA jco_private;
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL, status text NOT NULL
);
CREATE TABLE public.organization_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  country text,default_currency text,locale text,enable_public_website boolean
);
CREATE TABLE public.organization_branding (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  company_name text,logo_url text,primary_color text,secondary_color text,
  phone text,email text,website text,public_headline text,public_description text,
  public_hero_url text,public_office_address text,public_services jsonb,whatsapp text
);
CREATE TABLE public.properties (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id),
  code text,title text,description text,operation_type text,property_type text,
  price numeric,currency text,country text,state text,city text,neighborhood text,
  bedrooms integer,bathrooms numeric,parking_spaces integer,built_area numeric,
  lot_area numeric,administration_fee numeric,featured boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),status text NOT NULL,
  owner_phone text NOT NULL DEFAULT 'PRIVATE-OWNER-PHONE',
  internal_notes text NOT NULL DEFAULT 'PRIVATE-INTERNAL-NOTES'
);
CREATE TABLE jco_private.eligible (organization_id uuid PRIMARY KEY, enabled boolean NOT NULL);
CREATE FUNCTION jco_private.operational_access(p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=''
AS $f$
 SELECT EXISTS(SELECT 1 FROM jco_private.eligible
 WHERE organization_id=p_organization_id AND enabled)
$f$;

-- Owner-owned SECURITY DEFINER can query tables despite RLS; API roles cannot.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizations,public.organization_settings,public.organization_branding,public.properties
 FROM PUBLIC,anon,authenticated;
INSERT INTO public.organizations VALUES
 ('11111111-1111-4111-8111-111111111111','alpha','Alpha Agency','ACTIVE'),
 ('22222222-2222-4222-8222-222222222222','beta','Beta Agency','ACTIVE'),
 ('33333333-3333-4333-8333-333333333333','inactive','Inactive Agency','INACTIVE'),
 ('44444444-4444-4444-8444-444444444444','disabled','Disabled Agency','ACTIVE'),
 ('55555555-5555-4555-8555-555555555555','unpaid','Unpaid Agency','ACTIVE');
INSERT INTO public.organization_settings VALUES
 ('11111111-1111-4111-8111-111111111111','CO','COP','es-CO',true),
 ('22222222-2222-4222-8222-222222222222','CO','COP','es-CO',true),
 ('33333333-3333-4333-8333-333333333333','CO','COP','es-CO',true),
 ('44444444-4444-4444-8444-444444444444','CO','COP','es-CO',false),
 ('55555555-5555-4555-8555-555555555555','CO','COP','es-CO',true);
INSERT INTO jco_private.eligible VALUES
 ('11111111-1111-4111-8111-111111111111',true),
 ('22222222-2222-4222-8222-222222222222',true),
 ('33333333-3333-4333-8333-333333333333',true),
 ('44444444-4444-4444-8444-444444444444',true),
 ('55555555-5555-4555-8555-555555555555',false);
INSERT INTO public.organization_branding (organization_id,company_name,phone,email,public_headline)
 VALUES
 ('11111111-1111-4111-8111-111111111111','Alpha Public','3001111111','alpha@example.invalid','Alpha home'),
 ('22222222-2222-4222-8222-222222222222','Beta Public','3002222222','beta@example.invalid','Beta home');
INSERT INTO public.properties(id,organization_id,code,title,status,featured)
 VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','ALPHA-1','Featured Alpha','AVAILABLE',true),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','BETA-1','Beta only','AVAILABLE',true),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','ALPHA-SOLD','Sold Alpha','SOLD',true),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','ALPHA-RENT','Rented Alpha','RENTED',true);
INSERT INTO public.properties(id,organization_id,code,title,status,featured,created_at)
SELECT ('00000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,
 '11111111-1111-4111-8111-111111111111','ALPHA-'||n,'Alpha listing '||n,
 'AVAILABLE',false,now()-make_interval(secs=>n) FROM generate_series(1,105) n;
