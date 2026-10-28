-- All current listings were explicitly approved by their respective agencies
-- before stage-two was permitted to replace the public RPC.
SET ROLE anon;
SELECT public.consignment_test_assert(
  jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=1
  AND public.tenant_public_catalog('tenant-a')->'properties'->0->>'description'='Descripcion A aprobada'
  AND public.tenant_public_catalog('tenant-a')->'properties'->0->>'image_url'='https://example.org/listing-a.jpg',
  'tenant A sees only its approved public copy after gated cutover');
SELECT public.consignment_test_assert(
  jsonb_array_length(public.tenant_public_catalog('tenant-b')->'properties')=1
  AND public.tenant_public_catalog('tenant-b')->'properties'->0->>'description'='Descripcion B aprobada',
  'tenant B sees only its own approved public copy');
SELECT public.consignment_test_assert(
  public.tenant_public_catalog('tenant-a')::text NOT LIKE '%NOTAS PRIVADAS A%'
  AND public.tenant_public_catalog('tenant-b')::text NOT LIKE '%NOTAS PRIVADAS B%',
  'private inventory descriptions remain private');
SELECT public.consignment_test_assert(
  public.tenant_public_catalog('invalid-slug') IS NULL,
  'nonexistent storefront remains unavailable');
SELECT public.consignment_test_assert(
  NOT has_table_privilege('anon','public.property_publications','SELECT'),
  'approval metadata must not be directly selectable by anonymous clients');
RESET ROLE;

-- A future available property without prior consent does not leak publicly.
INSERT INTO public.properties
 (id,organization_id,code,title,description,operation_type,property_type,status,price,currency,city)
VALUES
 ('11111111-aaaa-4111-8111-111111111113','11111111-1111-1111-1111-111111111111',
  'A-3','Inventario privado nuevo','Secreto','SALE','HOUSE','AVAILABLE',1000000,'COP','Guarne');
SELECT public.consignment_test_assert(
 jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=1,
 'new available inventory is private until separately approved');

-- A status change unpublishes even an earlier explicitly approved listing.
UPDATE public.properties SET status='RENTED'
 WHERE id='11111111-aaaa-4111-8111-111111111111';
SELECT public.consignment_test_assert(
 (SELECT NOT published FROM public.property_publications
  WHERE property_id='11111111-aaaa-4111-8111-111111111111')
 AND jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=0,
 'rented property is removed from live opt-in catalogue');
UPDATE public.properties SET status='AVAILABLE'
 WHERE id='11111111-aaaa-4111-8111-111111111111';
SELECT public.consignment_test_assert(
 jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=0,
 'restoring available does not auto-republish the previously rented property');

-- Agency B is not allowed to inspect or revoke Agency A approvals.
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
SET ROLE authenticated;
SELECT public.consignment_test_assert(
 (SELECT count(*) FROM public.property_publications
  WHERE organization_id='11111111-1111-1111-1111-111111111111')=0,
 'agency B cannot see agency A approvals');
UPDATE public.property_publications SET published=false
 WHERE property_id='11111111-aaaa-4111-8111-111111111111';
RESET ROLE;
SELECT public.consignment_test_assert(
 (SELECT published FROM public.property_publications
  WHERE property_id='22222222-bbbb-4222-8222-222222222222'),
 'agency B approvals remain independently valid');
