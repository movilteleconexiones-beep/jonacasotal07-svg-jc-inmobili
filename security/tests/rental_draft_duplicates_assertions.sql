-- Isolated test DB after fixture + real migration. All DML rolled back.
BEGIN;
CREATE FUNCTION pg_temp.must_fail(statement text, wanted text, label text)
 RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text:=null;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN got:=SQLSTATE; END;
 IF got IS DISTINCT FROM wanted THEN
  RAISE EXCEPTION '% expected SQLSTATE %, got %',label,wanted,COALESCE(got,'SUCCESS');
 END IF;
END $$;

SELECT pg_temp.must_fail($s$
 INSERT INTO public.leases(id,organization_id,property_id,status,monthly_rent,start_date)
 VALUES ('70707070-7070-4070-8070-707070707070',
 '11111111-1111-4111-8111-111111111111',
 '10101010-1010-4010-8010-101010101010',
 'DRAFT',1700000,'2026-10-29')
$s$,'23505','duplicate draft on one dwelling blocked');
SELECT pg_temp.must_fail($s$
 INSERT INTO public.leases(id,organization_id,property_id,status,monthly_rent,start_date)
 VALUES ('71717171-7171-4171-8171-717171717171',
 '11111111-1111-4111-8111-111111111111',
 '10101010-1010-4010-8010-101010101010',
 'ACTIVE',1700000,'2026-10-29')
$s$,'23505','active lease cannot overlap draft');

INSERT INTO public.documents(organization_id,entity_type,entity_id,document_type,storage_bucket,storage_path)
 VALUES('11111111-1111-4111-8111-111111111111','GENERAL',
 '60606060-6060-4060-8060-606060606060','CONTRACT','organization-documents',
 '11111111-1111-4111-8111-111111111111/leases/60606060-6060-4060-8060-606060606060/signed/88888888-8888-4888-8888-888888888888.pdf');
SELECT pg_temp.must_fail($s$
 INSERT INTO public.documents(organization_id,entity_type,entity_id,document_type,storage_bucket,storage_path)
 VALUES('11111111-1111-4111-8111-111111111111','GENERAL',
 '60606060-6060-4060-8060-606060606060','CONTRACT','organization-documents',
 '11111111-1111-4111-8111-111111111111/leases/60606060-6060-4060-8060-606060606060/signed/99999999-9999-4999-8999-999999999999.pdf')
$s$,'23505','repeat signed PDF blocked at database');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
SELECT pg_temp.must_fail($s$
 SELECT public.admin_cancel_lease_draft('11111111-1111-4111-8111-111111111111',
 '60606060-6060-4060-8060-606060606060','Other tenant tries cancellation')
$s$,'42501','other organization cannot cancel');
SELECT pg_temp.must_fail($s$
 SELECT public.admin_correct_lease_draft(
 '11111111-1111-4111-8111-111111111111','60606060-6060-4060-8060-606060606060',
 '10101010-1010-4010-8010-101010101010',
 '30303030-3030-4030-8030-303030303030','50505050-5050-4050-8050-505050505050',
 1700001,'2026-10-29','2027-03-29','TEST-1088','Unauthorized other tenant')
$s$,'42501','non admin cannot correct');
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
SELECT pg_temp.must_fail($s$
 SELECT public.admin_correct_lease_draft(
 '11111111-1111-4111-8111-111111111111','60606060-6060-4060-8060-606060606060',
 '10101010-1010-4010-8010-101010101010',
 '30303030-3030-4030-8030-303030303030','50505050-5050-4050-8050-505050505050',
 1700001,'2026-10-29','2027-03-29','TEST-1088','Changing an already signed lease')
$s$,'23514','signed draft financial terms immutable');
SELECT public.admin_cancel_lease_draft(
 '11111111-1111-4111-8111-111111111111',
 '60606060-6060-4060-8060-606060606060',
 'A duplicate file was attached to draft');
RESET ROLE;
DO $$
BEGIN
 IF (SELECT status FROM public.leases WHERE id='60606060-6060-4060-8060-606060606060')<>'CANCELLED'
   OR (SELECT count(*) FROM public.documents
       WHERE entity_id='60606060-6060-4060-8060-606060606060')<>1
   OR (SELECT count(*) FROM public.audit_log WHERE action='lease.draft_cancelled')<>1
 THEN RAISE EXCEPTION 'Draft cancellation was not audited or its PDF was lost'; END IF;
END $$;

-- A cancelled draft must not permanently block creating a fresh lease.
INSERT INTO public.leases(id,organization_id,property_id,tenant_id,owner_id,status,
 monthly_rent,start_date,end_date,contract_number)
VALUES ('72727272-7272-4272-8272-727272727272',
 '11111111-1111-4111-8111-111111111111',
 '10101010-1010-4010-8010-101010101010',
 '30303030-3030-4030-8030-303030303030',
 '50505050-5050-4050-8050-505050505050',
 'DRAFT',1700000,'2026-10-29','2027-03-29','TEST-NEW');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
SELECT public.admin_correct_lease_draft(
 '11111111-1111-4111-8111-111111111111',
 '72727272-7272-4272-8272-727272727272',
 '10101010-1010-4010-8010-101010101010',
 '30303030-3030-4030-8030-303030303030',
 '50505050-5050-4050-8050-505050505050',
 1750000,'2026-10-29','2027-03-29','TEST-NEW',
 'Correct rental amount entered in error');
RESET ROLE;
DO $$
BEGIN
 IF (SELECT monthly_rent FROM public.leases
     WHERE id='72727272-7272-4272-8272-727272727272')<>1750000
 OR (SELECT count(*) FROM public.audit_log WHERE action='lease.draft_corrected')<>1
 OR (SELECT count(*) FROM public.documents
     WHERE entity_id='60606060-6060-4060-8060-606060606060')<>1
 THEN RAISE EXCEPTION 'Draft edit or PDF preservation failed'; END IF;
 IF has_function_privilege('anon',
   'public.admin_cancel_lease_draft(uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous draft cancellation unexpectedly allowed'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: no duplicate open lease/PDF; audited admin-only drafts; historical document retained' AS result;
