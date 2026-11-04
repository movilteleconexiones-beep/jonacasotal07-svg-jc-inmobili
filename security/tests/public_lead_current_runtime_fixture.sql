-- INMOJCO: synthetic, disposable PostgreSQL 17 fixture. NEVER apply to Supabase.
DO $roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $roles$;
CREATE SCHEMA private;
CREATE SCHEMA jco_private;
CREATE TABLE public.organizations (
 id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, status text NOT NULL
);
CREATE TABLE public.organization_settings (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 enable_public_website boolean NOT NULL
);
CREATE TABLE public.organization_branding (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 public_page_content jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.contacts (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 first_name text NOT NULL, email text NOT NULL, phone text NOT NULL,
 source text NOT NULL, notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.leads (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 contact_id uuid NOT NULL REFERENCES public.contacts(id),
 status text NOT NULL, priority text NOT NULL, notes text
);
CREATE TABLE jco_private.eligible (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id), enabled boolean NOT NULL
);
CREATE FUNCTION jco_private.operational_access(target_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $body$
 SELECT EXISTS(SELECT 1 FROM jco_private.eligible e
 WHERE e.organization_id=target_org AND e.enabled)
$body$;

-- Direct Data API access is forbidden; public RPCs alone write these rows.
REVOKE ALL ON public.organizations,public.organization_settings,
 public.organization_branding,public.contacts,public.leads FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SCHEMA private,jco_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

INSERT INTO public.organizations VALUES
 ('11111111-1111-4111-8111-111111111111','alpha','ACTIVE'),
 ('22222222-2222-4222-8222-222222222222','beta','ACTIVE'),
 ('33333333-3333-4333-8333-333333333333','suspended','SUSPENDED'),
 ('44444444-4444-4444-8444-444444444444','disabled','ACTIVE'),
 ('55555555-5555-4555-8555-555555555555','unpaid','ACTIVE'),
 ('66666666-6666-4666-8666-666666666666','no-policy','ACTIVE');
INSERT INTO public.organization_settings
SELECT id, slug <> 'disabled' FROM public.organizations;
INSERT INTO public.organization_branding (organization_id,public_page_content)
SELECT id,jsonb_build_object('privacyPolicyUrl','https://example.invalid/'||slug||'/privacidad')
FROM public.organizations WHERE slug <> 'no-policy';
INSERT INTO jco_private.eligible
SELECT id, slug <> 'unpaid' FROM public.organizations;
