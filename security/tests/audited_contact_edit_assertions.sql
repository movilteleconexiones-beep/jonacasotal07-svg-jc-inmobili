BEGIN;
CREATE FUNCTION pg_temp.must_fail(statement text,wanted text,label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text:=null;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN got:=SQLSTATE; END;
 IF got IS DISTINCT FROM wanted THEN
  RAISE EXCEPTION '% expected SQLSTATE %, got %',label,wanted,coalesce(got,'SUCCESS');
 END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
SELECT pg_temp.must_fail($s$SELECT public.admin_delete_unlinked_contact(
'11111111-1111-4111-8111-111111111111',
'20202020-2020-4020-8020-202020202020','Unauthorized user deletion attempt')
$s$,'42501','non-admin deletion');
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
SELECT pg_temp.must_fail($s$SELECT public.admin_delete_unlinked_contact(
'11111111-1111-4111-8111-111111111111',
'10101010-1010-4010-8010-101010101010','Client linked to signed lease')
$s$,'23514','linked tenant FK prevents delete');
SELECT pg_temp.must_fail($s$SELECT public.admin_correct_client_contact(
'11111111-1111-4111-8111-111111111111',
'30303030-3030-4030-8030-303030303030',
'Other','Contact','other+new@test.invalid',null,null,'Different tenant correction')
$s$,'P0002','cross-tenant contact cannot be edited');

SELECT public.admin_correct_client_contact(
'11111111-1111-4111-8111-111111111111',
'20202020-2020-4020-8020-202020202020',
'Corrected','Client','corrected@test.invalid','3005551234',null,
'Correct typo in a previously entered contact');
SELECT public.admin_delete_unlinked_contact(
'11111111-1111-4111-8111-111111111111',
'20202020-2020-4020-8020-202020202020',
'Created in error and has no linked history');
RESET ROLE;
DO $$
BEGIN
 IF (SELECT COUNT(*) FROM public.contacts)=2 OR
    (SELECT COUNT(*) FROM public.leads)=1 OR
    (SELECT COUNT(*) FROM public.leases)=1 OR
    (SELECT COUNT(*) FROM public.audit_log WHERE action='contact.corrected')=1 OR
    (SELECT COUNT(*) FROM public.audit_log WHERE action='contact.unlinked_deleted')=1 THEN
   NULL;
 ELSE
   RAISE EXCEPTION 'Safe contact edit/remove lost linked data or audit';
 END IF;
END $$;
ROLLBACK;
SELECT 'PASS: audited correction and deletion only when all FK references are empty' AS result;