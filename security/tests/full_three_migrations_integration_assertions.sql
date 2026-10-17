-- End-to-end test: strict property RLS + manually approved public storefront
-- + isolated domain/logo settings in ONE PostgreSQL 17 test database.
-- Never executes against INMOJCO production. All data is fabricated.
SELECT public.property_tenant_test_assert(
 (SELECT count(*) FROM public.property_publications)=0,
 'no inventory is published automatically by migrating the schema');
SELECT public.property_tenant_test_assert(
 (SELECT count(*) FROM public.agency_custom_domains)=0,
 'no customer domain is activated automatically');
SELECT public.property_tenant_test_assert(
 NOT has_table_privilege('anon','public.properties','SELECT')
 AND NOT has_table_privilege('anon','public.properties','INSERT')
 AND NOT has_table_privilege('anon','public.property_publications','SELECT'),
 'anonymous may only read approved catalog projections through the RPC');

-- Data owner manually approves one fabricated AVAILABLE property per tenant.
INSERT INTO public.property_publications(property_id,organization_id,published,public_description)
SELECT id,organization_id,true,
 CASE WHEN organization_id='22222222-2222-4222-8222-222222222222'
      THEN 'Oferta pública A' ELSE 'Oferta pública B' END
FROM public.properties;

SET ROLE anon;
-- The strongest boundary is an explicit SQL privilege error, not an
-- apparent zero-row response. Attempting SELECT would raise 42501.
SELECT public.property_tenant_test_assert(
 NOT has_table_privilege('anon','public.properties','SELECT'),
 'anon cannot issue any direct private inventory query (SQL 42501)');
SELECT public.property_tenant_test_assert(
 jsonb_array_length(public.get_public_agency_listings('tenant-a',24,0))=1
 AND public.get_public_agency_listings('tenant-a',24,0)->0->>'title'='Apartamento de A'
 AND jsonb_array_length(public.get_public_agency_listings('tenant-b',24,0))=1
 AND public.get_public_agency_listings('tenant-b',24,0)->0->>'title'='Apartamento de B',
 'public RPC shows only each explicitly approved agency listing');
SELECT public.property_tenant_test_assert(
 public.get_public_agency_listings('tenant-a',24,0)->0->>'description'='Oferta pública A'
 AND NOT (public.get_public_agency_listings('tenant-a',24,0)->0 ? 'organization_id')
 AND NOT (public.get_public_agency_listings('tenant-a',24,0)->0 ? 'address'),
 'no private organization ID or address in public commercial listing');
RESET ROLE;

-- Account E is B staff, but also only a CLIENT of tenant A.
SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
SET ROLE authenticated;
SELECT public.property_tenant_test_assert(
 (SELECT count(*) FROM public.properties)=1
 AND (SELECT count(*) FROM public.properties
      WHERE organization_id='abababab-abab-4bab-8bab-abababababab')=1,
 'mixed-role user reads staff organization B only, not client-only A');
SELECT public.property_tenant_test_assert(
 (SELECT count(*) FROM public.property_publications)=1,
 'B staff cannot directly list A publication metadata');
SELECT public.property_tenant_test_assert(
 public.get_my_agency_custom_domain('22222222-2222-4222-8222-222222222222') IS NULL
 AND public.get_my_agency_public_site('22222222-2222-4222-8222-222222222222') IS NULL,
 'B staff never reads A domain and public site configuration');
SELECT public.property_tenant_test_assert(
 public.request_agency_custom_domain(
 'abababab-abab-4bab-8bab-abababababab','www.agencia-b.com')->>'status'='PENDING_DNS',
 'B can request own hostname but not activate it');
INSERT INTO storage.objects(id,bucket_id,name)
VALUES('cececece-cece-4ece-8ece-cececececece','jco-agency-logos',
 'abababab-abab-4bab-8bab-abababababab/cececece-cece-4ece-8ece-cececececece.png');
RESET ROLE;

-- Account A is only staff of A, and must not inherit B's hostname privileges.
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
SET ROLE authenticated;
SELECT public.property_tenant_test_assert(
 (SELECT count(*) FROM public.properties)=1
 AND (SELECT count(*) FROM public.properties
      WHERE organization_id='22222222-2222-4222-8222-222222222222')=1,
 'staff of A sees only A private property');
SELECT public.property_tenant_test_assert(
 (SELECT count(*) FROM public.property_publications)=1
 AND public.get_my_agency_custom_domain(
  'abababab-abab-4bab-8bab-abababababab') IS NULL,
 'staff of A cannot enumerate B publications or domain');
RESET ROLE;

-- The public domain request is only a pending record; no routing to another
-- tenant and no certificate activation can occur from SQL alone.
SELECT public.property_tenant_test_assert(
 (SELECT count(*) FROM public.agency_custom_domains WHERE status='ACTIVE')=0
 AND (SELECT count(*) FROM public.agency_custom_domains WHERE status='PENDING_DNS')=1,
 'custom domains remain pending until verified by the central platform');

-- An unrelated read-only visitor sees no private inventory or DNS metadata.
SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false);
SET ROLE authenticated;
SELECT public.property_tenant_test_assert(
 (SELECT count(*) FROM public.properties)=0
 AND (SELECT count(*) FROM public.property_publications)=0
 AND (SELECT count(*) FROM public.agency_custom_domains)=0,
 'unlinked account cannot enumerate private inventory, publications or domains');
RESET ROLE;
