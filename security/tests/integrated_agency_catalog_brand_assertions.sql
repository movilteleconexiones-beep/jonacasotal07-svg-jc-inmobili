-- Exercises both migrations in the SAME disposable PostgreSQL 17 database
-- after catalog and domain assertions have run independently. No real users.
SELECT public.consignment_test_assert(
 jsonb_array_length(public.get_public_agency_listings('tenant-a',24,0))=3
 AND jsonb_array_length(public.get_public_agency_listings('tenant-b',24,0))=1,
 'Brand and domain migration must not corrupt either public inventory');

SELECT public.consignment_test_assert(
 (SELECT count(*) FROM public.property_publications)=7
 AND (SELECT count(*) FROM public.agency_custom_domains)=1,
 'Publication data and a pending DNS request coexist safely');

SELECT public.consignment_test_assert(
 NOT has_table_privilege('anon','public.agency_custom_domains','SELECT')
 AND NOT has_table_privilege('anon','public.property_publications','SELECT'),
 'Anonymous readers cannot enumerate private publication or domain tables');

SELECT set_config('request.jwt.claim.sub',
 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',false);
SET ROLE authenticated;
SELECT public.consignment_test_assert(
 public.get_my_agency_public_site(
 '11111111-1111-1111-1111-111111111111') IS NULL
 AND public.get_my_agency_custom_domain(
 '11111111-1111-1111-1111-111111111111') IS NULL,
 'B cannot read A site configuration or A domain ownership after combining migrations');

SELECT public.consignment_test_assert(
 public.request_agency_custom_domain(
 '22222222-2222-2222-2222-222222222222',
 'www.agencia-b.com')->>'status'='PENDING_DNS',
 'B can independently request its own pending DNS validation');

INSERT INTO storage.objects(id,bucket_id,name)
VALUES ('90909090-9090-4090-8090-909090909090','jco-agency-logos',
 '22222222-2222-2222-2222-222222222222/90909090-9090-4090-8090-909090909090.png');

SELECT public.consignment_test_assert(
 public.get_my_agency_custom_domain(
 '22222222-2222-2222-2222-222222222222')->>'hostname'='www.agencia-b.com',
 'B can read its own pending hostname, not A hostname');
RESET ROLE;

-- Catalog projection never inherits the private session's agency, and
-- adding another tenant's DNS request never changes public inventory.
SET ROLE anon;
SELECT public.consignment_test_assert(
 jsonb_array_length(public.get_public_agency_listings('tenant-a',24,0))=3
 AND jsonb_array_length(public.get_public_agency_listings('tenant-b',24,0))=1,
 'Anonymous storefront A and B remain isolated after both domains are requested');
RESET ROLE;
SELECT public.consignment_test_assert(
 (SELECT count(*) FROM public.agency_custom_domains WHERE status='ACTIVE')=0,
 'Neither agency gets active routing or TLS from a pending domain request');
