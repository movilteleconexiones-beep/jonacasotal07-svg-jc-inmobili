-- Disposable PostgreSQL fixture for the exact captured onboarding RPC.
-- Simplified table definitions: does not reproduce production RLS or triggers.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE public.country_profiles(country_code text PRIMARY KEY,active boolean NOT NULL,currency_code text,timezone text,language text,locale text);
CREATE TABLE public.organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,slug text NOT NULL UNIQUE,status text NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED','TRIAL','INACTIVE')));
CREATE TABLE public.organization_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,user_id uuid NOT NULL,status text NOT NULL CHECK(status IN ('INVITED','ACTIVE','SUSPENDED','INACTIVE')),joined_at timestamptz,UNIQUE(organization_id,user_id));
CREATE TABLE public.organization_branding(organization_id uuid REFERENCES public.organizations(id),company_name text,software_name text);
CREATE TABLE public.organization_settings(organization_id uuid REFERENCES public.organizations(id),default_currency text,country text,timezone text,language text,locale text);
CREATE TABLE public.compliance_packs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),country_code text,status text,effective_date date,created_at timestamptz DEFAULT now());
CREATE TABLE public.organization_compliance(organization_id uuid REFERENCES public.organizations(id),compliance_pack_id uuid REFERENCES public.compliance_packs(id),status text);
CREATE TABLE public.roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,key text,name text NOT NULL,description text,is_system_role boolean,active boolean,UNIQUE(organization_id,name));
CREATE TABLE public.permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text UNIQUE);
CREATE TABLE public.role_permissions(role_id uuid REFERENCES public.roles(id),permission_id uuid REFERENCES public.permissions(id),PRIMARY KEY(role_id,permission_id));
CREATE TABLE public.member_roles(organization_member_id uuid REFERENCES public.organization_members(id) ON DELETE CASCADE,role_id uuid REFERENCES public.roles(id) ON DELETE CASCADE,PRIMARY KEY(organization_member_id,role_id));
CREATE TABLE public.audit_log(organization_id uuid REFERENCES public.organizations(id),actor_user_id uuid,action text,entity_type text,entity_id uuid,metadata jsonb);
INSERT INTO public.country_profiles VALUES ('CO',true,'COP','America/Bogota','es','es-CO');
INSERT INTO public.permissions(key) VALUES ('roles.assign'),('properties.view');
INSERT INTO public.compliance_packs(country_code,status,effective_date) VALUES ('CO','ACTIVE',CURRENT_DATE);
