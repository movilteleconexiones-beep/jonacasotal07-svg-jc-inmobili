CREATE SCHEMA auth;
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE FUNCTION public.is_rental_lifecycle_admin(org uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog' AS $$
 SELECT auth.uid()='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid AND
 org='11111111-1111-4111-8111-111111111111'::uuid
$$;
CREATE FUNCTION public.has_org_permission(org uuid,permission_key text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog'
 AS $$ SELECT public.is_rental_lifecycle_admin(org) AND permission_key='clients.edit' $$;
CREATE TABLE public.contacts(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,first_name text NOT NULL,
 last_name text,email text,phone text,whatsapp text,updated_at timestamptz DEFAULT now());
CREATE TABLE public.leases(id uuid PRIMARY KEY,tenant_id uuid REFERENCES public.contacts(id) ON DELETE RESTRICT);
CREATE TABLE public.leads(id uuid PRIMARY KEY,contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE);
CREATE TABLE public.audit_log(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,organization_id uuid,
 actor_user_id uuid,action text NOT NULL,entity_type text,entity_id uuid,metadata jsonb);
INSERT INTO public.contacts(id,organization_id,first_name,email) VALUES
 ('10101010-1010-4010-8010-101010101010','11111111-1111-4111-8111-111111111111','Tenant','tenant@test.invalid'),
 ('20202020-2020-4020-8020-202020202020','11111111-1111-4111-8111-111111111111','Wrong','wrong@test.invalid'),
 ('30303030-3030-4030-8030-303030303030','22222222-2222-4222-8222-222222222222','Other','other@test.invalid');
INSERT INTO public.leases VALUES('40404040-4040-4040-8040-404040404040','10101010-1010-4010-8010-101010101010');
INSERT INTO public.leads VALUES('50505050-5050-4050-8050-505050505050','10101010-1010-4010-8010-101010101010');