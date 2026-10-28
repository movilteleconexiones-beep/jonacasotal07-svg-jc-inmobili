-- Fake schema extension for opt-in tenant catalogue integration, no production data.
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS jco_private;
GRANT USAGE ON SCHEMA private,jco_private TO authenticated;
CREATE FUNCTION jco_private.is_internal_staff(target_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.has_org_permission(target_org,'properties.edit')
$$;
CREATE OR REPLACE FUNCTION jco_private.operational_access(target_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.organizations o WHERE o.id=target_org AND o.status='ACTIVE')
$$;
ALTER TABLE public.organizations ADD COLUMN slug text;
UPDATE public.organizations SET slug=CASE id
 WHEN '11111111-1111-1111-1111-111111111111' THEN 'tenant-a'
 WHEN '22222222-2222-2222-2222-222222222222' THEN 'tenant-b'
 ELSE 'tenant-inactive' END;
ALTER TABLE public.organization_settings ADD COLUMN locale text;
ALTER TABLE public.properties
  ADD COLUMN featured boolean NOT NULL DEFAULT false,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE public.organization_branding(
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 company_name text,logo_url text,primary_color text,secondary_color text,
 phone text,email text,website text,whatsapp text,
 public_headline text,public_description text,public_hero_url text,
 public_office_address text,public_services jsonb,public_page_content jsonb
);
INSERT INTO public.organization_settings(organization_id,country,default_currency,enable_public_website,locale)
 SELECT id,'CO','COP',true,'es-CO' FROM public.organizations;
INSERT INTO public.organization_branding(organization_id,company_name)
 SELECT id,name FROM public.organizations;
INSERT INTO public.properties
 (id,organization_id,code,title,description,operation_type,property_type,status,price,currency,city)
 VALUES
 ('11111111-aaaa-4111-8111-111111111111','11111111-1111-1111-1111-111111111111',
  'A-1','Casa A','NOTAS PRIVADAS A','SALE','HOUSE','AVAILABLE',280000000,'COP','Medellín'),
 ('22222222-bbbb-4222-8222-222222222222','22222222-2222-2222-2222-222222222222',
  'B-1','Casa B','NOTAS PRIVADAS B','RENT','APARTMENT','AVAILABLE',1900000,'COP','Cali'),
 ('11111111-aaaa-4111-8111-111111111112','11111111-1111-1111-1111-111111111111',
  'A-2','Contrato interno','Datos confidenciales','RENT','HOUSE','RENTED',3000000,'COP','Medellín');
INSERT INTO public.consignment_test_permissions
 VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,'22222222-2222-2222-2222-222222222222'::uuid,'properties.edit');
