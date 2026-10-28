-- This suite must PASS with STAGE 1 only; stage-2 cutover is NOT installed.
-- Before the administrator approves, all live fictional listings stay visible.
SELECT public.consignment_test_assert(
  jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=1,
  'stage1 does not remove current storefront listings');
SELECT public.consignment_test_assert(
  (SELECT count(*) FROM public.property_publications)=0,
  'stage1 never auto-creates approvals for available properties');

INSERT INTO public.property_publications(
  property_id,organization_id,published,public_description,public_photo_url)
VALUES (
  '11111111-aaaa-4111-8111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  true,'Aprobada antes del cambio','https://example.org/listing.jpg');

SELECT public.consignment_test_assert(
 jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=1,
 'preapproval does not change legacy storefront visibility');

-- A published listing must have human-reviewed public copy; a null/empty
-- description cannot silently replace the description of a live listing.
DO $verify_nonempty_copy$
BEGIN
  BEGIN
    UPDATE public.property_publications
       SET public_description='   '
     WHERE property_id='11111111-aaaa-4111-8111-111111111111';
    RAISE EXCEPTION 'empty public description was wrongly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$verify_nonempty_copy$;
SELECT public.consignment_test_assert(
 (SELECT published AND public_description='Aprobada antes del cambio'
  FROM public.property_publications
  WHERE property_id='11111111-aaaa-4111-8111-111111111111'),
 'invalid description update leaves reviewed copy intact');

SET ROLE anon;
SELECT public.consignment_test_assert(
 NOT has_table_privilege('anon','public.property_publications','SELECT'),
 'visitors must not read private publication approvals directly');
SELECT public.consignment_test_assert(
 jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=1,
 'anonymous visitors retain currently visible catalog during staging');
RESET ROLE;

-- Tenant B can neither view nor alter tenant A publication records.
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
SET ROLE authenticated;
SELECT public.consignment_test_assert(
 (SELECT count(*) FROM public.property_publications
  WHERE organization_id='11111111-1111-1111-1111-111111111111')=0,
 'tenant B cannot see tenant A preapprovals');
UPDATE public.property_publications SET published=false
 WHERE property_id='11111111-aaaa-4111-8111-111111111111';
RESET ROLE;
SELECT public.consignment_test_assert(
 (SELECT published FROM public.property_publications
  WHERE property_id='11111111-aaaa-4111-8111-111111111111'),
 'tenant B cannot change tenant A preapprovals');

-- Status transition revokes the preapproval but keeps the old legacy rules.
UPDATE public.properties SET status='RENTED'
 WHERE id='11111111-aaaa-4111-8111-111111111111';
SELECT public.consignment_test_assert(
 NOT (SELECT published FROM public.property_publications
      WHERE property_id='11111111-aaaa-4111-8111-111111111111')
 AND jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=0,
 'rented property becomes unavailable and approval is withdrawn');
UPDATE public.properties SET status='AVAILABLE'
 WHERE id='11111111-aaaa-4111-8111-111111111111';
SELECT public.consignment_test_assert(
 jsonb_array_length(public.tenant_public_catalog('tenant-a')->'properties')=1
 AND NOT (SELECT published FROM public.property_publications
   WHERE property_id='11111111-aaaa-4111-8111-111111111111'),
 're-available legacy listing stays visible until stage 2, without auto-reapproval');
