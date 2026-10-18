-- Availability alone MUST NOT publish a privately managed property.
SELECT public.consignment_test_assert(
 jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=0,
 'existing available private inventory never auto-publishes');
INSERT INTO public.property_publications(
 property_id,organization_id,published,public_description,public_photo_url)
 VALUES
 ('11111111-aaaa-4111-8111-111111111111',
  '11111111-1111-1111-1111-111111111111',true,'Descripcion aprobada',
  'https://example.org/aprobada.jpg'),
 ('22222222-bbbb-4222-8222-222222222222',
  '22222222-2222-2222-2222-222222222222',true,'Descripcion B',NULL);

SET ROLE anon;
SELECT public.consignment_test_assert(
 jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=1
 AND public.tenant_public_catalog('tenant-a')->'properties'->0->>'description'='Descripcion aprobada'
 AND public.tenant_public_catalog('tenant-a')->'properties'->0->>'image_url'='https://example.org/aprobada.jpg',
 'approved projection includes only approved public description and photo');
SELECT public.consignment_test_assert(
 public.tenant_public_catalog('tenant-a')::text NOT LIKE '%NOTAS PRIVADAS A%'
 AND public.tenant_public_catalog('tenant-a')::text NOT LIKE '%Datos confidenciales%',
 'private property notes never leave the RPC');
SELECT public.consignment_test_assert(
 jsonb_array_length(public.tenant_public_catalog('tenant-b')->'properties')=1
 AND jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=1,
 'tenant A and B each see only its own approved listing');
SELECT public.consignment_test_assert(
 public.tenant_public_catalog('tenant-inactive') IS NULL
 AND public.tenant_public_catalog('invalid-tenant') IS NULL,
 'suspended and nonexistent tenants are not enumerable');
SELECT public.consignment_test_assert(
 NOT has_table_privilege('anon','public.property_publications','SELECT'),
 'anonymous role cannot query publication metadata directly');
RESET ROLE;

-- A legitimate agency B editor may see its own publication but not A's.
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
SET ROLE authenticated;
SELECT public.consignment_test_assert(
 (SELECT count(*) FROM public.property_publications
  WHERE organization_id='11111111-1111-1111-1111-111111111111')=0,
 'agency B cannot SELECT agency A approvals');
UPDATE public.property_publications SET published=false
 WHERE property_id='11111111-aaaa-4111-8111-111111111111';
SELECT public.consignment_test_assert(
 (SELECT count(*) FROM public.property_publications WHERE published AND
  organization_id='22222222-2222-2222-2222-222222222222')=1,
 'agency B remains unaffected by any attempted agency A update');
RESET ROLE;

-- The publication trigger denies cross-tenant forgery.
DO $$
BEGIN
 BEGIN
  INSERT INTO public.property_publications(property_id,organization_id,published)
  VALUES('11111111-aaaa-4111-8111-111111111111',
         '22222222-2222-2222-2222-222222222222',true)
  ON CONFLICT(property_id) DO UPDATE SET organization_id=EXCLUDED.organization_id;
  RAISE EXCEPTION 'missing publication tenant guard';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;

-- A rented/sold property loses published status and will not silently reappear.
UPDATE public.properties SET status='RENTED'
 WHERE id='11111111-aaaa-4111-8111-111111111111';
SELECT public.consignment_test_assert(
 (SELECT NOT published FROM public.property_publications
 WHERE property_id='11111111-aaaa-4111-8111-111111111111')
 AND jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=0,
 'rented item is unpublished');
UPDATE public.properties SET status='AVAILABLE'
 WHERE id='11111111-aaaa-4111-8111-111111111111';
SELECT public.consignment_test_assert(
 jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=0,
 'returning to available does not auto-publish');
