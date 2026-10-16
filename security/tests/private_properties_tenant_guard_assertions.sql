CREATE FUNCTION public.property_tenant_test_assert(ok boolean,description text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',description;END IF;END $test$;

SELECT public.property_tenant_test_assert(
 (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public'
 AND tablename='properties' AND policyname='jco_private_properties_tenant_read_boundary'
 AND permissive='RESTRICTIVE' AND cmd='SELECT')=1,
 'a restrictive property SELECT guard exists');
SELECT public.property_tenant_test_assert(
 NOT has_table_privilege('anon','public.properties','SELECT'),
 'anonymous direct access is revoked');

-- Staff user A has organization membership and VIEW only in A, never B.
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
SET ROLE authenticated;
SELECT public.property_tenant_test_assert(
 (SELECT COUNT(*) FROM public.properties)=1,
 'A can only see A even with permissive legacy policy and helper');
SELECT public.property_tenant_test_assert(
 (SELECT COUNT(*) FROM public.properties
 WHERE organization_id='abababab-abab-4bab-8bab-abababababab')=0,
 'A cannot SELECT B property with broad legacy policy');
-- Unlinked user cannot read either property despite broad legacy helper.
SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false);
SELECT public.property_tenant_test_assert(
 (SELECT COUNT(*) FROM public.properties)=0,
 'an unlinked external user cannot access private stock');
RESET ROLE;

-- Existing external tenant with lease sees only their own connected row.
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
SET ROLE authenticated;
SELECT public.property_tenant_test_assert(
 (SELECT COUNT(*) FROM public.properties)=1,
 'tenant with verified personal lease retains access to own property');
RESET ROLE;

-- Duplicate re-application should not weaken or create an extra SELECT policy.
SELECT public.property_tenant_test_assert(
 (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public'
 AND tablename='properties' AND policyname='jco_private_properties_tenant_read_boundary')=1,
 'only one guard after migration');
