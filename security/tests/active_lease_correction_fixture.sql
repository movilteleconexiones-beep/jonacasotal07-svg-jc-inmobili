-- PostgreSQL 17 isolated CI data. Not applicable to any Supabase production DB.
CREATE SCHEMA auth;
CREATE SCHEMA jco_private;
CREATE SCHEMA storage;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE FUNCTION public.is_rental_lifecycle_admin(org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog' AS $$
 SELECT auth.uid()='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
 AND org='11111111-1111-4111-8111-111111111111'::uuid $$;
CREATE FUNCTION public.has_org_permission(org uuid,p text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog' AS $$
 SELECT public.is_rental_lifecycle_admin(org)
 AND p IN ('leases.edit','documents.view') $$;

CREATE TABLE public.leases(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,property_id uuid NOT NULL,
 tenant_id uuid,owner_id uuid,status text NOT NULL,
 monthly_rent numeric NOT NULL,start_date date NOT NULL,end_date date,
 contract_number text,payment_day integer,adjustment_type text,
 adjustment_percentage numeric,updated_at timestamptz DEFAULT now()
);
GRANT SELECT, UPDATE ON public.leases TO authenticated;
CREATE TABLE public.documents(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,entity_type text NOT NULL,
 entity_id uuid,document_type text NOT NULL,storage_bucket text,storage_path text,
 mime_type text,title text
);
CREATE TABLE storage.objects(bucket_id text NOT NULL,name text NOT NULL,PRIMARY KEY(bucket_id,name));
CREATE TABLE public.rent_payments(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,lease_id uuid,
 period_month date NOT NULL,expected_amount numeric NOT NULL,
 paid_amount numeric NOT NULL,status text NOT NULL
);
CREATE TABLE public.rent_receipts(id uuid PRIMARY KEY,rent_payment_id uuid NOT NULL);
CREATE TABLE public.owner_statements(id uuid PRIMARY KEY,organization_id uuid NOT NULL,lease_id uuid);
CREATE TABLE public.lease_rent_amendments(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,lease_id uuid,
 effective_month date NOT NULL,new_monthly_rent numeric NOT NULL
);
CREATE TABLE public.audit_log(
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY,organization_id uuid,
 actor_user_id uuid,action text,entity_type text,entity_id uuid,metadata jsonb
);
INSERT INTO public.leases(id,organization_id,property_id,tenant_id,owner_id,status,
 monthly_rent,start_date,end_date,contract_number) VALUES
 ('11111111-1111-4111-8111-111111111110','11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222220',
  '33333333-3333-4333-8333-333333333330',
  '44444444-4444-4444-8444-444444444440','ACTIVE',1300000,
  '2026-10-29','2027-03-29','TEST-1088'),
 ('55555555-5555-4555-8555-555555555550','22222222-2222-4222-8222-222222222222',
  '66666666-6666-4666-8666-666666666660',
  '77777777-7777-4777-8777-777777777770',NULL,'ACTIVE',500000,
  '2026-10-29','2027-03-29','OTHER-LEASE');
INSERT INTO public.documents(id,organization_id,entity_type,entity_id,document_type,storage_bucket,storage_path,mime_type,title)
VALUES('88888888-8888-4888-8888-888888888880',
'11111111-1111-4111-8111-111111111111','GENERAL',
'11111111-1111-4111-8111-111111111110','CONTRACT','organization-documents',
'11111111-1111-4111-8111-111111111111/leases/11111111-1111-4111-8111-111111111110/signed/99999999-9999-4999-8999-999999999990.pdf',
'application/pdf','Firmado 1088');
INSERT INTO storage.objects VALUES('organization-documents',
'11111111-1111-4111-8111-111111111111/leases/11111111-1111-4111-8111-111111111110/signed/99999999-9999-4999-8999-999999999990.pdf');
INSERT INTO public.rent_payments(id,organization_id,lease_id,period_month,expected_amount,paid_amount,status)
VALUES('abababab-abab-4bab-8bab-abababababab',
'11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111110',
'2026-10-01',1700000,0,'PENDING');
INSERT INTO public.lease_rent_amendments VALUES(
'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111',
'11111111-1111-4111-8111-111111111110','2026-11-01',1700000);
