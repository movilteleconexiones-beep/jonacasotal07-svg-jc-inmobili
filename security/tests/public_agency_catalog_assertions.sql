-- A tenant's public site can only show its manually approved AVAILABLE rows.
INSERT INTO public.property_publications(property_id,organization_id,published,public_description,public_photo_url)
VALUES
 ('11111111-aaaa-4111-8111-111111111111','11111111-1111-1111-1111-111111111111',true,'Descripción comercial A','https://example.org/casa-a.jpg'),
 ('22222222-bbbb-4222-8222-222222222222','22222222-2222-2222-2222-222222222222',true,'Descripción comercial B',NULL),
 ('11111111-aaaa-4111-8111-111111111112','11111111-1111-1111-1111-111111111111',false,NULL,NULL),
 ('11111111-aaaa-4111-8111-111111111113','11111111-1111-1111-1111-111111111111',false,NULL,NULL),
 ('33333333-cccc-4333-8333-333333333333','33333333-3333-3333-3333-333333333333',true,NULL,NULL);

SELECT public.consignment_test_assert(jsonb_array_length(public.get_public_agency_listings('tenant-a'))=1,
 'A receives only one listed AVAILABLE property');
SELECT public.consignment_test_assert(jsonb_array_length(public.get_public_agency_listings('tenant-b'))=1,
 'B receives only one property');
SELECT public.consignment_test_assert(jsonb_array_length(public.get_public_agency_listings('tenant-c'))=0,
 'inactive organization cannot publish');
SELECT public.consignment_test_assert(jsonb_array_length(public.get_public_agency_listings('does-not-exist'))=0,
 'unknown slug cannot enumerate inventory');
SELECT public.consignment_test_assert(public.get_public_agency_listings('tenant-a')->0->>'title'='Casa A',
 'agency A must only see A');
SELECT public.consignment_test_assert(public.get_public_agency_listings('tenant-b')->0->>'title'='Casa B',
 'agency B must only see B');
SELECT public.consignment_test_assert(
  NOT (public.get_public_agency_listings('tenant-a')->0 ? 'organization_id')
  AND NOT (public.get_public_agency_listings('tenant-a')->0 ? 'address')
  AND NOT (public.get_public_agency_listings('tenant-a')->0 ? 'owner_id')
  AND NOT (public.get_public_agency_listings('tenant-a')->0 ? 'description_private'),
 'public API must not reveal tenant IDs, address or private fields');
SELECT public.consignment_test_assert(
  public.get_public_agency_listings('tenant-a')->0->>'description'='Descripción comercial A'
  AND public.get_public_agency_listings('tenant-a')::text NOT LIKE '%DESCRIPCION PRIVADA%',
 'public description must be explicitly approved, not private notes');
SET ROLE anon;
SELECT public.consignment_test_assert((SELECT count(*) FROM public.properties)=0,
 'anonymous direct properties SELECT must be blocked by private RLS');
RESET ROLE;
SELECT public.consignment_test_assert(NOT has_table_privilege('anon','public.property_publications','SELECT'),
 'anonymous cannot directly read publication metadata');
SELECT public.consignment_test_assert(has_function_privilege('anon','public.get_public_agency_listings(text,integer,integer)','EXECUTE'),
 'anonymous receives only controlled catalog RPC access');

UPDATE private.property_intake_sites SET enabled=false WHERE slug='tenant-a';
SELECT public.consignment_test_assert(jsonb_array_length(public.get_public_agency_listings('tenant-a'))=0,
 'disabled site must reveal no property');
UPDATE private.property_intake_sites SET enabled=true WHERE slug='tenant-a';

-- Invalid/mismatched tenant publication cannot be inserted, even as database owner.
DO $test$
BEGIN
 BEGIN
  INSERT INTO public.property_publications(property_id,organization_id,published)
  VALUES ('11111111-aaaa-4111-8111-111111111111',
    '22222222-2222-2222-2222-222222222222',true)
  ON CONFLICT(property_id) DO UPDATE SET organization_id=excluded.organization_id;
  RAISE EXCEPTION 'Expected tenant mismatch to fail';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $test$;

-- Authenticated user B cannot edit or even read tenant A's publication.
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
SET ROLE authenticated;
SELECT public.consignment_test_assert(
 (SELECT count(*) FROM public.property_publications WHERE organization_id='11111111-1111-1111-1111-111111111111')=0,
 'tenant B cannot read tenant A publication');
DO $test$ DECLARE n integer;
BEGIN
 UPDATE public.property_publications SET published=false
 WHERE property_id='11111111-aaaa-4111-8111-111111111111';
 GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM public.consignment_test_assert(n=0,'B cannot unpublish A');
END $test$;
SELECT public.consignment_test_assert(
 jsonb_array_length(public.get_public_agency_listings('tenant-b'))=1,
 'anonymous projection still scopes B, regardless of signed-in user');
RESET ROLE;

-- B cannot configure or disable A's site. A can manage only its own site.
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
SET ROLE authenticated;
DO $test$
BEGIN
 BEGIN
  PERFORM public.configure_my_agency_public_site('11111111-1111-1111-1111-111111111111',false);
  RAISE EXCEPTION 'Missing cross-tenant authorization guard';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $test$;
SELECT public.consignment_test_assert(
 public.get_my_agency_public_site('11111111-1111-1111-1111-111111111111') IS NULL,
 'B must not read configuration for A');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
SET ROLE authenticated;
SELECT public.consignment_test_assert(
 public.configure_my_agency_public_site('11111111-1111-1111-1111-111111111111',false)='tenant-a',
 'A can disable its own public site');
SELECT public.consignment_test_assert(
 jsonb_array_length(public.get_public_agency_listings('tenant-a'))=0,
 'site disabled by authorized owner hides every listing');
SELECT public.consignment_test_assert(
 public.configure_my_agency_public_site('11111111-1111-1111-1111-111111111111',true)='tenant-a',
 'A can restore its own public site');
RESET ROLE;


-- Pagination regression: 3 approved listings from A, with stable order across
-- page boundaries and no cross-tenant leakage even if codes sort differently.
INSERT INTO public.properties (
 id,organization_id,code,title,description,operation_type,property_type,
 status,price,currency,city,featured,created_at
) VALUES (
 '11111111-aaaa-4111-8111-111111111114',
 '11111111-1111-1111-1111-111111111111',
 'ZZ99','Casa A secundaria','CONFIDENCIAL',
 'SALE','HOUSE','AVAILABLE',80000000,'COP','Medellín',
 true, now() - interval '1 day'
), (
 '11111111-aaaa-4111-8111-111111111115',
 '11111111-1111-1111-1111-111111111111',
 'AA00','Casa A tercera','CONFIDENCIAL',
 'SALE','HOUSE','AVAILABLE',70000000,'COP','Medellín',
 false, now() + interval '1 day'
);
INSERT INTO public.property_publications(property_id,organization_id,published)
VALUES
 ('11111111-aaaa-4111-8111-111111111114',
 '11111111-1111-1111-1111-111111111111',true),
 ('11111111-aaaa-4111-8111-111111111115',
 '11111111-1111-1111-1111-111111111111',true);

SELECT public.consignment_test_assert(
 jsonb_array_length(public.get_public_agency_listings('tenant-a',1,0))=1
 AND public.get_public_agency_listings('tenant-a',1,0)->0->>'title'='Casa A',
 'first paginated item is the most recently created featured property');
SELECT public.consignment_test_assert(
 public.get_public_agency_listings('tenant-a',1,1)->0->>'title'='Casa A secundaria',
 'second page has the older featured property');
SELECT public.consignment_test_assert(
 public.get_public_agency_listings('tenant-a',1,2)->0->>'title'='Casa A tercera'
 AND jsonb_array_length(public.get_public_agency_listings('tenant-a',1,3))=0,
 'third page contains nonfeatured property and pagination terminates');
SELECT public.consignment_test_assert(
 (SELECT count(DISTINCT row_item->>'id')
  FROM jsonb_array_elements(public.get_public_agency_listings('tenant-a',24,0)) AS row_item)=3,
 'each page and full listing contain distinct property identities');
SELECT public.consignment_test_assert(
 jsonb_array_length(public.get_public_agency_listings('tenant-b',24,0))=1,
 'pagination never leaks listings from agency A into B');

-- Publication is revocable by inventory lifecycle, never restored automatically.
-- 111114 was explicitly published and AVAILABLE in the pagination scenario.
UPDATE public.properties SET status='RENTED'
WHERE id='11111111-aaaa-4111-8111-111111111114';
SELECT public.consignment_test_assert(
 (SELECT published=false FROM public.property_publications
  WHERE property_id='11111111-aaaa-4111-8111-111111111114')
 AND jsonb_array_length(public.get_public_agency_listings('tenant-a',24,0))=2,
 'rented listing is automatically unpublished and excluded from public RPC');
UPDATE public.properties SET status='AVAILABLE'
WHERE id='11111111-aaaa-4111-8111-111111111114';
SELECT public.consignment_test_assert(
 (SELECT published=false FROM public.property_publications
  WHERE property_id='11111111-aaaa-4111-8111-111111111114')
 AND jsonb_array_length(public.get_public_agency_listings('tenant-a',24,0))=2,
 'becoming available again NEVER silently restores public approval');
UPDATE public.property_publications SET published=true
WHERE property_id='11111111-aaaa-4111-8111-111111111114';
SELECT public.consignment_test_assert(
 jsonb_array_length(public.get_public_agency_listings('tenant-a',24,0))=3,
 'only explicitly reapproving an AVAILABLE property publishes it again');

DO $test$
BEGIN
 BEGIN
  UPDATE public.property_publications SET published=true
  WHERE property_id='11111111-aaaa-4111-8111-111111111113';
  RAISE EXCEPTION 'Expected rented publication to be rejected';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $test$;
SELECT public.consignment_test_assert(
 (SELECT published=false FROM public.property_publications
  WHERE property_id='11111111-aaaa-4111-8111-111111111113'),
 'service process cannot mark rented inventory as published');
