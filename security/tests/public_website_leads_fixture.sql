-- Standalone security fixture. It must never run on production.
DO $roles$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $roles$;
CREATE SCHEMA jco_private;
CREATE TABLE public.organizations (id uuid PRIMARY KEY,slug text UNIQUE NOT NULL,status text NOT NULL);
CREATE TABLE public.organization_settings (organization_id uuid PRIMARY KEY,enable_public_website boolean NOT NULL);
CREATE TABLE public.organization_branding (organization_id uuid PRIMARY KEY, public_page_content jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,
  first_name text NOT NULL,email text,phone text,source text NOT NULL,
  notes text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,
  contact_id uuid REFERENCES public.contacts(id),status text NOT NULL,
  priority text NOT NULL,notes text
);
CREATE OR REPLACE FUNCTION jco_private.operational_access(target_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.organizations WHERE id=target_org AND status='ACTIVE')
$$;
INSERT INTO public.organizations(id,slug,status) VALUES
  ('00000000-0000-4000-8000-000000000001','alpha-agency','ACTIVE'),
  ('00000000-0000-4000-8000-000000000002','bravo-agency','ACTIVE'),
  ('00000000-0000-4000-8000-000000000003','disabled-agency','ACTIVE'),
  ('00000000-0000-4000-8000-000000000004','suspended-agency','SUSPENDED');
INSERT INTO public.organization_settings(organization_id,enable_public_website)
 SELECT id, slug <> 'disabled-agency' FROM public.organizations;
INSERT INTO public.organization_branding(organization_id,public_page_content)
 SELECT id,jsonb_build_object('privacyPolicyUrl','https://example.test/privacidad')
 FROM public.organizations WHERE slug IN ('alpha-agency','bravo-agency','disabled-agency','suspended-agency');

