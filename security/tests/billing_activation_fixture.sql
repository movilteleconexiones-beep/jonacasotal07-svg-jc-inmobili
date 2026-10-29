-- Isolated PostgreSQL only. Mirrors the official schema's billing columns.
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
CREATE TABLE public.organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,slug text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','TRIAL','SUSPENDED','INACTIVE')),
 plan_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE NOT NULL,name text NOT NULL,description text,
 billing_cycle text NOT NULL,price numeric NOT NULL DEFAULT 0,currency text NOT NULL DEFAULT 'USD',active boolean NOT NULL DEFAULT true,
 max_users integer,max_properties integer,max_storage_mb integer,ai_credits integer,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE public.plan_features(plan_id uuid REFERENCES public.plans(id),feature_key text,enabled boolean DEFAULT true,feature_limit numeric,PRIMARY KEY(plan_id,feature_key));
CREATE TABLE public.subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid UNIQUE NOT NULL REFERENCES public.organizations(id),plan_id uuid REFERENCES public.plans(id),
 status text NOT NULL,billing_mode text NOT NULL,started_at timestamptz,current_period_start timestamptz,current_period_end timestamptz,trial_ends_at timestamptz,cancelled_at timestamptz,updated_at timestamptz DEFAULT now());
CREATE TABLE public.organization_licenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid UNIQUE NOT NULL REFERENCES public.organizations(id),
 license_type text NOT NULL,status text NOT NULL DEFAULT 'ACTIVE',starts_at timestamptz DEFAULT now(),ends_at timestamptz,updated_at timestamptz DEFAULT now());
CREATE TABLE public.license_terms_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version text,title text,terms_markdown text NOT NULL,active boolean NOT NULL DEFAULT true,effective_date date DEFAULT current_date,created_at timestamptz DEFAULT now());
CREATE TABLE public.license_acceptances(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid REFERENCES public.organizations(id),organization_license_id uuid REFERENCES public.organization_licenses(id),
 terms_version_id uuid REFERENCES public.license_terms_versions(id),accepted_by uuid REFERENCES auth.users(id),accepted_at timestamptz NOT NULL DEFAULT now(),terms_snapshot text,acceptance_user_agent text);
CREATE TABLE public.platform_admins(user_id uuid PRIMARY KEY REFERENCES auth.users(id),admin_level text NOT NULL DEFAULT 'SUPER_ADMIN',active boolean NOT NULL DEFAULT true);
CREATE TABLE public.organization_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid REFERENCES public.organizations(id),user_id uuid REFERENCES auth.users(id),status text NOT NULL);
CREATE TABLE public.roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid REFERENCES public.organizations(id),key text,active boolean NOT NULL DEFAULT true);
CREATE TABLE public.permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text UNIQUE NOT NULL);
CREATE TABLE public.member_roles(organization_member_id uuid REFERENCES public.organization_members(id),role_id uuid REFERENCES public.roles(id),PRIMARY KEY(organization_member_id,role_id));
CREATE TABLE public.role_permissions(role_id uuid REFERENCES public.roles(id),permission_id uuid REFERENCES public.permissions(id),PRIMARY KEY(role_id,permission_id));
CREATE TABLE public.member_permissions(organization_member_id uuid REFERENCES public.organization_members(id),permission_id uuid REFERENCES public.permissions(id),effect text,PRIMARY KEY(organization_member_id,permission_id));
CREATE TABLE public.audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,actor_user_id uuid,action text NOT NULL,entity_type text,entity_id uuid,metadata jsonb);
CREATE TABLE public.properties(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid REFERENCES public.organizations(id),title text);
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY property_member_access ON public.properties FOR ALL TO authenticated USING(true) WITH CHECK(true);
CREATE FUNCTION public.is_org_member(target_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=target_org AND user_id=auth.uid() AND status='ACTIVE') $$;
CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.has_org_permission(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.platform_set_subscription(uuid,text,text,text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
INSERT INTO auth.users VALUES('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000003'),('10000000-0000-0000-0000-000000000004');
INSERT INTO public.platform_admins(user_id) VALUES('10000000-0000-0000-0000-000000000003');
INSERT INTO public.platform_admins(user_id,admin_level) VALUES('10000000-0000-0000-0000-000000000004','SUPPORT');
INSERT INTO public.organizations(id,name,slug) VALUES('20000000-0000-0000-0000-000000000001','Legacy Principal','legacy-principal');
INSERT INTO public.plans(code,name,billing_cycle) VALUES('BASIC','Basic','MONTHLY'),('PRO','Pro','MONTHLY'),('ENTERPRISE','Enterprise','CUSTOM'),('LIFETIME','Lifetime','ONE_TIME');
INSERT INTO public.permissions(key) VALUES('properties.view'),('properties.create'),('clients.view'),('settings.view'),('settings.edit'),('reports.view'),('documents.view'),('commissions.view');
INSERT INTO public.permissions(key) VALUES('documents.upload'),('documents.delete'),('properties.edit');
UPDATE public.plans SET max_users=5,max_properties=200 WHERE code='BASIC';
UPDATE public.plans SET max_users=25,max_properties=2000 WHERE code='PRO';
CREATE SCHEMA storage;
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text NOT NULL,name text NOT NULL);
GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;
GRANT ALL ON storage.objects TO anon,authenticated,service_role;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir subir imagenes a usuarios autenticados" ON storage.objects FOR INSERT WITH CHECK(true);
CREATE POLICY "Permitir eliminar imagenes a usuarios autenticados" ON storage.objects FOR DELETE USING(true);
