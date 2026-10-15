-- Regression gate: two distinct tenants and two distinct owners in ONE organization.
-- Run after external_portal_staff_seats_assertions.sql in an isolated PostgreSQL fixture.
-- Never execute on the real Supabase database.
BEGIN;
SET CONSTRAINTS ALL DEFERRED;

-- Existing unlinked prospect becomes a second tenant. A new CLIENT-only
-- member is a second owner; neither consumes an additional staff seat.
INSERT INTO public.organization_members VALUES
 ('30303030-3030-4030-8030-303030303030',
  '22222222-2222-4222-8222-222222222222',
  'ffffffff-ffff-4fff-8fff-ffffffffffff','ACTIVE');
INSERT INTO public.member_roles VALUES
 ('30303030-3030-4030-8030-303030303030',
  '33333333-3333-4333-8333-333333333333');

INSERT INTO public.contacts VALUES
 ('24242424-2424-4242-8242-242424242424',
  '22222222-2222-4222-8222-222222222222');
INSERT INTO public.property_owners VALUES
 ('25252525-2525-4252-8252-252525252525',
  '22222222-2222-4222-8222-222222222222');
INSERT INTO public.properties VALUES
 ('26262626-2626-4262-8262-262626262626',
  '22222222-2222-4222-8222-222222222222');
INSERT INTO public.property_ownerships VALUES
 ('25252525-2525-4252-8252-252525252525',
  '26262626-2626-4262-8262-262626262626');
INSERT INTO public.portal_access_links VALUES
 ('27272727-2727-4272-8272-272727272727',
  '22222222-2222-4222-8222-222222222222',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '24242424-2424-4242-8242-242424242424',NULL),
 ('28282828-2828-4282-8282-282828282828',
  '22222222-2222-4222-8222-222222222222',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  NULL,'25252525-2525-4252-8252-252525252525');
INSERT INTO public.leases VALUES
 ('29292929-2929-4292-8292-292929292929',
  '22222222-2222-4222-8222-222222222222',
  '26262626-2626-4262-8262-262626262626',
  '25252525-2525-4252-8252-252525252525',
  '24242424-2424-4242-8242-242424242424','ACTIVE');
INSERT INTO public.rent_payments VALUES
 ('31313131-3131-4313-8313-313131313131',
  '22222222-2222-4222-8222-222222222222',
  '29292929-2929-4292-8292-292929292929');
INSERT INTO public.owner_statements VALUES
 ('32323232-3232-4323-8323-323232323232',
  '22222222-2222-4222-8222-222222222222',
  '25252525-2525-4252-8252-252525252525','ISSUED',now());

-- Documents for separate owners. No tenant is allowed to browse them.
INSERT INTO public.documents VALUES
 ('34343434-3434-4343-8343-343434343434',
  '22222222-2222-4222-8222-222222222222',
  'OWNER','99999999-9999-4999-8999-999999999999'),
 ('35353535-3535-4353-8353-353535353535',
  '22222222-2222-4222-8222-222222222222',
  'OWNER','25252525-2525-4252-8252-252525252525');
COMMIT;

SELECT public.test_assert(
 jco_private.is_external_only_member('30303030-3030-4030-8030-303030303030'),
 'second property owner stays external-only without staff seat');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
SELECT public.test_assert((SELECT count(*) FROM public.leases)=1,
 'tenant A only sees lease A, never lease B in same agency');
SELECT public.test_assert((SELECT count(*) FROM public.rent_payments)=1,
 'tenant A only sees payment A, never payment B');
SELECT public.test_assert((SELECT count(*) FROM public.properties)=1,
 'tenant A only sees property A');
SELECT public.test_assert((SELECT count(*) FROM public.owner_statements)=0,
 'tenant A cannot read either owner statement');
SELECT public.test_assert((SELECT count(*) FROM public.documents)=0,
 'tenant A cannot read owner document');

SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false);
SELECT public.test_assert((SELECT count(*) FROM public.leases)=1,
 'tenant B only sees lease B');
SELECT public.test_assert((SELECT count(*) FROM public.rent_payments)=1,
 'tenant B only sees payment B');
SELECT public.test_assert((SELECT count(*) FROM public.properties)=1,
 'tenant B only sees property B');
SELECT public.test_assert((SELECT count(*) FROM public.portal_access_links)=1,
 'tenant B cannot see other client links');
SELECT public.test_assert((SELECT count(*) FROM public.owner_statements)=0,
 'tenant B cannot read owner statements');

SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
SELECT public.test_assert((SELECT count(*) FROM public.leases)=1,
 'owner A only sees own property lease');
SELECT public.test_assert((SELECT count(*) FROM public.rent_payments)=1,
 'owner A only sees own rent payment');
SELECT public.test_assert((SELECT count(*) FROM public.owner_statements)=1,
 'owner A only sees issued statement A');
SELECT public.test_assert((SELECT count(*) FROM public.properties)=1,
 'owner A only sees property A');
SELECT public.test_assert((SELECT count(*) FROM public.documents)=1,
 'owner A only sees document A');

SELECT set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',false);
SELECT public.test_assert((SELECT count(*) FROM public.leases)=1,
 'owner B only sees own property lease');
SELECT public.test_assert((SELECT count(*) FROM public.rent_payments)=1,
 'owner B only sees own rent payment');
SELECT public.test_assert((SELECT count(*) FROM public.owner_statements)=1,
 'owner B only sees issued statement B');
SELECT public.test_assert((SELECT count(*) FROM public.properties)=1,
 'owner B only sees property B');
SELECT public.test_assert((SELECT count(*) FROM public.documents)=1,
 'owner B only sees document B');
SELECT public.test_assert((SELECT count(*) FROM public.deals)=0,
 'owner B cannot inspect internal CRM');

-- Writes by external users must remain entirely disabled, even for linked rows.
DO $external_checks$
DECLARE affected integer;
BEGIN
 UPDATE public.leases SET status='TERMINATED'
  WHERE id='29292929-2929-4292-8292-292929292929';
 GET DIAGNOSTICS affected=ROW_COUNT;
 PERFORM public.test_assert(affected=0,'owner B cannot update own lease');
 DELETE FROM public.owner_statements
  WHERE id='32323232-3232-4323-8323-323232323232';
 GET DIAGNOSTICS affected=ROW_COUNT;
 PERFORM public.test_assert(affected=0,'owner B cannot delete own statement');
END $external_checks$;

SELECT set_config('request.jwt.claim.sub','99999999-1111-4111-8111-111111111111',false);
SELECT public.test_assert((SELECT count(*) FROM public.leases)=0,
 'unauthenticated identity without membership cannot read leases');
SELECT public.test_assert((SELECT count(*) FROM public.portal_access_links)=0,
 'unknown identity cannot browse portal links');

-- Operational staff still sees all linked contracts within the organization.
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
SELECT public.test_assert((SELECT count(*) FROM public.leases)=2,
 'authorized internal staff still sees both agency leases');
RESET ROLE;
