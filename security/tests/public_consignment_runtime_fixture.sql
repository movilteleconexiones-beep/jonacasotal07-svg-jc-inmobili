-- Disposable PostgreSQL 17 test only. Every row and agency is synthetic.
DO $roles$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $roles$;
CREATE SCHEMA private;
CREATE SCHEMA jco_private;
CREATE TABLE public.organizations (
 id uuid PRIMARY KEY, slug text NOT NULL UNIQUE,name text NOT NULL,status text NOT NULL
);
CREATE TABLE public.organization_settings (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 country text,default_currency text,enable_public_website boolean
);
CREATE TABLE private.property_intake_sites (
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 slug text NOT NULL UNIQUE,enabled boolean NOT NULL,
 hourly_limit integer NOT NULL,daily_limit integer NOT NULL
);
CREATE TABLE public.property_consignments (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 request_id uuid NOT NULL,
 contact_name text NOT NULL,contact_phone text NOT NULL,payload jsonb NOT NULL,
 reference text NOT NULL DEFAULT ('SYN-'||pg_catalog.substr(pg_catalog.gen_random_uuid()::text,1,8)),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,request_id)
);
CREATE TABLE jco_private.entitled (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id), enabled boolean NOT NULL
);
CREATE FUNCTION jco_private.operational_access(target_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $func$
 SELECT EXISTS(SELECT 1 FROM jco_private.entitled e
 WHERE e.organization_id=target_org AND e.enabled)
$func$;
REVOKE ALL ON public.organizations,public.organization_settings,public.property_consignments
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON private.property_intake_sites FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SCHEMA private,jco_private FROM PUBLIC,anon,authenticated;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA public TO anon,authenticated;
ALTER TABLE public.property_consignments ENABLE ROW LEVEL SECURITY;
INSERT INTO public.organizations VALUES
 ('11111111-1111-4111-8111-111111111111','alpha','Alpha Inmobiliaria','ACTIVE'),
 ('22222222-2222-4222-8222-222222222222','beta','Beta Inmobiliaria','ACTIVE'),
 ('33333333-3333-4333-8333-333333333333','suspended','Suspended','SUSPENDED'),
 ('44444444-4444-4444-8444-444444444444','disabled','Disabled','ACTIVE'),
 ('55555555-5555-4555-8555-555555555555','unpaid','Unpaid','ACTIVE'),
 ('66666666-6666-4666-8666-666666666666','hidden','Hidden','ACTIVE');
INSERT INTO public.organization_settings
SELECT id,'CO','COP',slug<>'hidden' FROM public.organizations;
INSERT INTO private.property_intake_sites
SELECT id,slug||'-form',slug<>'disabled',2,3 FROM public.organizations;
INSERT INTO jco_private.entitled
SELECT id,slug<>'unpaid' FROM public.organizations;
