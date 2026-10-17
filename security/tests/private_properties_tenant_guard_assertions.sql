CREATE FUNCTION public.property_tenant_test_assert(ok boolean,description text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',description;END IF;END $test$;

SELECT public.property_tenant_test_assert(
 (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public'
 AND tablename='properties' AND policyname='jco_private_properties_tenant_read_boundary'
 AND permissive='RESTRICTIVE' AND cmd='SELECT')=1,
 'a restrictive property SELECT guard exists');
SELECT public.property_tenant_test_assert(
 NOT has_table_privilege('anon','public.properties','SELECT')
 AND NOT has_table_privilege('anon','public.properties','INSERT')
 AND NOT has_table_privilege('anon','public.properties','UPDATE')
 AND NOT has_table_privilege('anon','public.properties','DELETE'),
 'anonymous cannot read or mutate private property records even if a permissive policy is added');

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
-- Two memberships: administrator in one company, CLIENT only in another.
SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
SELECT public.property_tenant_test_assert(
 (SELECT COUNT(*) FROM public.properties WHERE organization_id='22222222-2222-4222-8222-222222222222')=0,
 'active CLIENT membership alone grants no private inventory');
SELECT public.property_tenant_test_assert(
 (SELECT COUNT(*) FROM public.properties WHERE organization_id='abababab-abab-4bab-8bab-abababababab')=1,
 'authorized staff can see its own agency');
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
