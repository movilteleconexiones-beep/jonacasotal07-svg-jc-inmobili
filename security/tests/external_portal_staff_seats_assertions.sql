-- SQL tests exercise the real two migrations against an isolated data fixture.
CREATE FUNCTION public.test_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; END $$;
SELECT public.test_assert(jco_private.is_external_only_member('77777777-7777-4777-8777-777777777777'),'CLIENT-only is external');
SELECT public.test_assert(NOT jco_private.is_external_only_member('55555555-5555-4555-8555-555555555555'),'ADMIN counted as staff');
SELECT public.test_assert((
 SELECT count(*) FROM public.organization_members m WHERE m.status='ACTIVE'
  AND NOT jco_private.is_external_only_member(m.id))=2,'two counted staff');
-- At internal capacity, another CLIENT member can still join in the same transaction.
BEGIN;
INSERT INTO public.organization_members VALUES
 ('18181818-1818-4818-8818-181818181818','22222222-2222-4222-8222-222222222222',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd','ACTIVE');
INSERT INTO public.member_roles VALUES
 ('18181818-1818-4818-8818-181818181818','33333333-3333-4333-8333-333333333333');
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
SELECT public.test_assert(jco_private.is_external_only_member('18181818-1818-4818-8818-181818181818'),
 'third CLIENT excluded from seat count');
-- Mixed CLIENT+ADMIN must consume a staff seat, even when CLIENT was assigned first.
DO $$
DECLARE reason text;
BEGIN
 BEGIN
  INSERT INTO public.member_roles VALUES
   ('18181818-1818-4818-8818-181818181818','44444444-4444-4444-8444-444444444444');
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'Expected staff seat denial';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
   IF reason NOT LIKE '%Internal staff seat limit reached%' THEN RAISE EXCEPTION 'Unexpected denial: %',reason; END IF;
 END;
END $$;
SELECT public.test_assert(jco_private.is_external_only_member('18181818-1818-4818-8818-181818181818'),
 'failed mixed-role conversion rolled back');
INSERT INTO public.permissions VALUES('19191919-1919-4919-8919-191919191919','users.edit');
DO $$
DECLARE reason text;
BEGIN
 BEGIN
  INSERT INTO public.role_permissions VALUES
   ('33333333-3333-4333-8333-333333333333','19191919-1919-4919-8919-191919191919');
  RAISE EXCEPTION 'Expected CLIENT permission rejection';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
   IF reason NOT LIKE '%External CLIENT role cannot be granted%' THEN RAISE EXCEPTION 'Unexpected denial: %',reason; END IF;
 END;
END $$;
-- An owner with only CLIENT role and owner_id portal link also stays outside staff seats.
BEGIN;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO public.organization_members VALUES
 ('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ACTIVE');
INSERT INTO public.member_roles VALUES
 ('20202020-2020-4020-8020-202020202020','33333333-3333-4333-8333-333333333333');
INSERT INTO public.portal_access_links VALUES
 ('21212121-2121-4121-8121-212121212121',
  '22222222-2222-4222-8222-222222222222',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  NULL,'99999999-9999-4999-8999-999999999999');
COMMIT;
SELECT public.test_assert(jco_private.is_external_only_member('20202020-2020-4020-8020-202020202020'),
  'property owner stays outside staff seat quota');
-- Direct per-member ALLOW on CLIENT-only must also be rejected at the database.
DO $$
DECLARE reason text;
BEGIN
 BEGIN
  INSERT INTO public.member_permissions VALUES(
   '77777777-7777-4777-8777-777777777777',
   '19191919-1919-4919-8919-191919191919','ALLOW');
  RAISE EXCEPTION 'Expected external manual permission denial';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
  IF reason NOT LIKE '%External CLIENT must not receive operational permission overrides%'
  THEN RAISE EXCEPTION 'Unexpected permission bypass: %',reason; END IF;
 END;
END $$;
-- RLS checks: selected user is the third external tenant with an actual lease.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
SELECT public.test_assert((SELECT count(*) FROM public.leases)=1,'only own tenant lease visible');
SELECT public.test_assert((SELECT count(*) FROM public.rent_payments)=1,'own lease payments visible');
SELECT public.test_assert((SELECT count(*) FROM public.owner_statements)=0,'tenant cannot read owner statements');
SELECT public.test_assert((SELECT count(*) FROM public.contacts)=0,'client cannot browse contacts');
SELECT public.test_assert((SELECT count(*) FROM public.deals)=0,'client cannot browse CRM deals');
SELECT public.test_assert((SELECT count(*) FROM public.commissions)=0,'client cannot browse commissions');
SELECT public.test_assert((SELECT count(*) FROM public.organization_members)=1,'client sees only own membership');
SELECT public.test_assert((SELECT count(*) FROM public.portal_access_links)=1,'client sees only own link');
SELECT public.test_assert((SELECT count(*) FROM public.properties)=1,'tenant sees own leased property');
SELECT public.test_assert((SELECT count(*) FROM public.property_consignments)=0,'external cannot browse intake queue');
-- An unlinked CLIENT member cannot see even the above tenant records.
SELECT set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false);
SELECT public.test_assert((SELECT count(*) FROM public.leases)=0,'unlinked prospect sees no leases');
SELECT public.test_assert((SELECT count(*) FROM public.properties)=0,'prospect cannot browse private property rows');
SELECT public.test_assert((SELECT count(*) FROM public.rent_payments)=0,'prospect has no financial reads');
SELECT public.test_assert((SELECT count(*) FROM public.portal_access_links)=0,'prospect has no other client links');
SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',false);
SELECT public.test_assert((SELECT count(*) FROM public.owner_statements)=1,'property owner only sees issued statement');
SELECT public.test_assert((SELECT count(*) FROM public.rent_payments)=1,'property owner sees own lease payment');
SELECT public.test_assert((SELECT count(*) FROM public.deals)=0,'owner cannot read client deals');
-- Genuine staff still get internal access.
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
SELECT public.test_assert((SELECT count(*) FROM public.contacts)=1,'staff retains tenant contacts');
SELECT public.test_assert((SELECT count(*) FROM public.deals)=1,'staff retains CRM');
SELECT public.test_assert((SELECT count(*) FROM public.organization_members)=5,'staff can inspect tenant roster');
RESET ROLE;

-- The six production-shaped RESTRICTIVE ALL policies are split by operation.
SELECT public.test_assert(
 (SELECT count(*) FROM pg_policies
   WHERE schemaname='public'
    AND tablename IN ('portal_access_links','properties','leases','rent_payments','owner_statements','documents')
    AND policyname='jco_commercial_portal_read_guard'
    AND permissive='RESTRICTIVE' AND cmd='SELECT')=6,
 'all six portal read gates stay restrictive');
SELECT public.test_assert(
 (SELECT count(*) FROM pg_policies
   WHERE schemaname='public'
    AND tablename IN ('portal_access_links','properties','leases','rent_payments','owner_statements','documents')
    AND policyname IN ('jco_commercial_staff_insert_guard','jco_commercial_staff_update_guard','jco_commercial_staff_delete_guard')
    AND permissive='RESTRICTIVE' AND cmd IN ('INSERT','UPDATE','DELETE'))=18,
 'writes remain guarded by restrictive staff-only policies');
SELECT public.test_assert(
 (SELECT count(*) FROM pg_policies
   WHERE schemaname='public'
    AND tablename IN ('portal_access_links','properties','leases','rent_payments','owner_statements','documents')
    AND policyname='jco_commercial_access')=0,
 'obsolete restrictive ALL gates removed from private portal tables');
