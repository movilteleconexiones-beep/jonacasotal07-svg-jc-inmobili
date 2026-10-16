-- Isolated Postgres fixture built atop property_consignment_fixture.sql and
-- 20261010212630_property_consignment_intake.sql. No production records.
CREATE SCHEMA jco_private;
GRANT USAGE ON SCHEMA jco_private TO authenticated;
CREATE FUNCTION jco_private.is_internal_staff(target_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.has_org_permission(target_org,'properties.edit');
$$;
GRANT EXECUTE ON FUNCTION jco_private.is_internal_staff(uuid) TO authenticated;

ALTER TABLE public.properties
 ADD COLUMN featured boolean NOT NULL DEFAULT false,
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

INSERT INTO private.property_intake_sites(slug,organization_id,enabled)
VALUES ('tenant-a','11111111-1111-1111-1111-111111111111',true),
       ('tenant-b','22222222-2222-2222-2222-222222222222',true),
       ('tenant-c','33333333-3333-3333-3333-333333333333',true);
INSERT INTO public.properties
 (id,organization_id,code,title,description,operation_type,property_type,status,
  price,currency,city,neighborhood,featured)
VALUES
 ('11111111-aaaa-4111-8111-111111111111','11111111-1111-1111-1111-111111111111','0001','Casa A',
  'DESCRIPCION PRIVADA A / teléfono','SALE','HOUSE','AVAILABLE',100000000,'COP','Medellín','El Poblado',true),
 ('22222222-bbbb-4222-8222-222222222222','22222222-2222-2222-2222-222222222222','0001','Casa B',
  'DESCRIPCION PRIVADA B','RENT','APARTMENT','AVAILABLE',1900000,'COP','Cali','San Fernando',false),
 ('11111111-aaaa-4111-8111-111111111112','11111111-1111-1111-1111-111111111111','0002','Contrato arrendado',
  'ARRENDATARIO CONFIDENCIAL','RENT','HOUSE','RENTED',2000000,'COP','Bogotá','Centro',false),
 ('11111111-aaaa-4111-8111-111111111113','11111111-1111-1111-1111-111111111111','0003','Borrador A',
  'DATOS PRIVADOS','RENT','HOUSE','DRAFT',2500000,'COP','Bogotá','Centro',false),
 ('33333333-cccc-4333-8333-333333333333','33333333-3333-3333-3333-333333333333','0004','Inmueble suspendido',
  'INTERNO','SALE','HOUSE','AVAILABLE',300000000,'COP','Medellín','Poblado',false);

-- The legitimate A administrator controls only A's public website.
INSERT INTO public.consignment_test_permissions(user_id,organization_id,permission_key)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','settings.view'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','settings.edit');
