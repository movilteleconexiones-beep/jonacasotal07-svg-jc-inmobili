-- ONLY for an isolated PostgreSQL 17 CI database after billing_activation_fixture.sql.
-- Required historical table shapes for the real production onboarding RPC.
-- Never execute this file against Supabase or any persistent database.
ALTER TABLE public.organization_members ADD COLUMN joined_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.roles ADD COLUMN name text;
ALTER TABLE public.roles ADD COLUMN description text;
ALTER TABLE public.roles ADD COLUMN is_system_role boolean NOT NULL DEFAULT false;
ALTER TABLE public.organization_licenses ADD COLUMN operational_control_full boolean NOT NULL DEFAULT false;
ALTER TABLE public.organization_licenses ADD COLUMN copyright_transferred boolean NOT NULL DEFAULT false;
ALTER TABLE public.organization_licenses ADD COLUMN resale_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE public.organization_licenses ADD COLUMN sublicensing_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE public.organization_licenses ADD COLUMN redistribution_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE public.organization_licenses ADD COLUMN white_label_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE public.organization_licenses ADD COLUMN terms_version_id uuid REFERENCES public.license_terms_versions(id);
CREATE TABLE public.country_profiles(
  country_code text PRIMARY KEY,active boolean NOT NULL,currency_code text NOT NULL,
  timezone text NOT NULL,language text NOT NULL,locale text NOT NULL);
CREATE TABLE public.compliance_packs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), country_code text NOT NULL,
  status text NOT NULL,effective_date date,created_at timestamptz DEFAULT now());
CREATE TABLE public.organization_compliance(
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  compliance_pack_id uuid REFERENCES public.compliance_packs(id),status text NOT NULL);
CREATE TABLE public.organization_branding(
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  company_name text NOT NULL,software_name text);
CREATE TABLE public.organization_settings(
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  default_currency text,country text,timezone text,language text,locale text);
INSERT INTO public.country_profiles VALUES('CO',true,'COP','America/Bogota','es','es-CO');
INSERT INTO public.compliance_packs(country_code,status,effective_date)
VALUES('CO','ACTIVE',current_date);
-- Fixture-only owner accounts and no real email addresses.
INSERT INTO public.license_terms_versions(id,version,title,terms_markdown)
VALUES('40000000-0000-0000-0000-000000000006','2','Contrato sintético',
  'INTEGRATION FIXTURE ONLY. NO COMMERCIAL AGREEMENT.');
