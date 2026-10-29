-- Standalone PostgreSQL 17 test database, not Supabase production.
CREATE SCHEMA auth;
CREATE SCHEMA jco_private;
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END $$;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE FUNCTION public.is_rental_lifecycle_admin(target_org uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog'
AS $$
 SELECT auth.uid()='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  AND target_org='11111111-1111-4111-8111-111111111111'::uuid
$$;
CREATE FUNCTION public.has_org_permission(org uuid,permission_key text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog'
AS $$ SELECT public.is_rental_lifecycle_admin(org) AND permission_key='leases.edit' $$;

CREATE TABLE public.properties(id uuid PRIMARY KEY,organization_id uuid NOT NULL,
 status text NOT NULL,operation_type text NOT NULL);
CREATE TABLE public.contacts(id uuid PRIMARY KEY,organization_id uuid NOT NULL);
CREATE TABLE public.property_owners(id uuid PRIMARY KEY,organization_id uuid NOT NULL,
 agency_status text NOT NULL);
CREATE TABLE public.property_ownerships(property_id uuid NOT NULL,owner_id uuid NOT NULL);
CREATE TABLE public.leases(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,property_id uuid NOT NULL,
 tenant_id uuid,owner_id uuid,status text NOT NULL,
 monthly_rent numeric NOT NULL,start_date date NOT NULL,end_date date,
 contract_number text,updated_at timestamptz DEFAULT now());
CREATE TABLE public.rent_payments(organization_id uuid NOT NULL,lease_id uuid);
CREATE TABLE public.owner_statements(organization_id uuid NOT NULL,lease_id uuid);
CREATE TABLE public.documents(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 organization_id uuid NOT NULL,entity_type text NOT NULL,entity_id uuid,
 document_type text NOT NULL,storage_bucket text,storage_path text);
CREATE TABLE public.audit_log(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 organization_id uuid,actor_user_id uuid,action text NOT NULL,
 entity_type text,entity_id uuid,metadata jsonb,created_at timestamptz DEFAULT now());

INSERT INTO public.properties VALUES
 ('10101010-1010-4010-8010-101010101010','11111111-1111-4111-8111-111111111111','AVAILABLE','RENT'),
 ('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','AVAILABLE','RENT');
INSERT INTO public.contacts VALUES
 ('30303030-3030-4030-8030-303030303030','11111111-1111-4111-8111-111111111111'),
 ('40404040-4040-4040-8040-404040404040','22222222-2222-4222-8222-222222222222');
INSERT INTO public.property_owners VALUES
 ('50505050-5050-4050-8050-505050505050','11111111-1111-4111-8111-111111111111','ACTIVE');
INSERT INTO public.property_ownerships VALUES
 ('10101010-1010-4010-8010-101010101010','50505050-5050-4050-8050-505050505050');
INSERT INTO public.leases(id,organization_id,property_id,tenant_id,owner_id,status,monthly_rent,start_date,end_date,contract_number)
VALUES ('60606060-6060-4060-8060-606060606060',
 '11111111-1111-4111-8111-111111111111',
 '10101010-1010-4010-8010-101010101010',
 '30303030-3030-4030-8030-303030303030',
 '50505050-5050-4050-8050-505050505050','DRAFT',
 1700000,'2026-10-29','2027-03-29','TEST-1088');