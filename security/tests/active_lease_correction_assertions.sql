BEGIN;
CREATE FUNCTION pg_temp.must_fail(statement text,wanted text,label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text:=null;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN got:=SQLSTATE; END;
 IF got IS DISTINCT FROM wanted THEN RAISE EXCEPTION '% expected %, got %',label,wanted,coalesce(got,'SUCCESS'); END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
SELECT pg_temp.must_fail($s$
 SELECT public.admin_rectify_active_lease(
 '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111110',
 1700000,'2027-03-29','TEST-1088','88888888-8888-4888-8888-888888888880',
 'Unauthorized client correction attempt')
$s$,'42501','unprivileged user');
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
SELECT pg_temp.must_fail($s$
 SELECT public.admin_rectify_active_lease(
 '22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555550',
 600000,'2027-03-29','OTHER-LEASE','88888888-8888-4888-8888-888888888880',
 'Cross-organization malicious correction attempt')
$s$,'42501','foreign tenant');
SELECT pg_temp.must_fail($s$
 SELECT public.admin_rectify_active_lease(
 '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111110',
 1700000,'2027-03-29','TEST-1088','99999999-9999-4999-8999-999999999999',
 'Document ID from another contract')
$s$,'23514','wrong supporting PDF');
SELECT pg_temp.must_fail($s$
 SELECT public.admin_rectify_active_lease(
 '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111110',
 1800000,'2027-03-29','TEST-1088','88888888-8888-4888-8888-888888888880',
 'Discrepant unpaid period should prevent correction')
$s$,'23514','mismatched recorded rent obligation');

SELECT public.admin_rectify_active_lease(
 '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111110',
 1700000,'2027-03-29','TEST-1088','88888888-8888-4888-8888-888888888880',
 'Administrative correction justified by the signed contract');
SELECT pg_temp.must_fail($s$
 UPDATE public.leases SET monthly_rent=1400000
 WHERE id='11111111-1111-4111-8111-111111111110'
$s$,'42501','direct update cannot bypass audited procedure');
SELECT pg_temp.must_fail($s$
 UPDATE public.leases SET tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 WHERE id='11111111-1111-4111-8111-111111111110'
$s$,'23514','active contract cannot change tenant directly');
SELECT pg_temp.must_fail($s$
 UPDATE public.leases SET status='FINISHED',end_date='2026-10-29',monthly_rent=1800000
 WHERE id='11111111-1111-4111-8111-111111111110'
$s$,'23514','lease finish cannot disguise a rent rewrite');
-- The existing lifecycle guard permits an authorized finish to replace end_date
-- with the actual handover date; our additional guard cannot break that.
UPDATE public.leases SET status='FINISHED',end_date='2026-10-29'
 WHERE id='11111111-1111-4111-8111-111111111110';
RESET ROLE;
DO $$
BEGIN
 IF (SELECT status FROM public.leases WHERE id='11111111-1111-4111-8111-111111111110')<>'FINISHED'
 OR (SELECT monthly_rent FROM public.leases WHERE id='11111111-1111-4111-8111-111111111110')<>1700000
 OR (SELECT expected_amount FROM public.rent_payments WHERE id='abababab-abab-4bab-8bab-abababababab')<>1700000
 OR (SELECT count(*) FROM public.documents WHERE id='88888888-8888-4888-8888-888888888880')<>1
 OR (SELECT count(*) FROM public.audit_log WHERE action='lease.active_rectified')<>1
 OR (SELECT count(*) FROM jco_private.active_lease_correction_permits)<>0
 THEN RAISE EXCEPTION 'Active signed contract audit, billing or permit invariant failed'; END IF;
 IF (SELECT (metadata->>'financial_movements_modified')::boolean
     FROM public.audit_log WHERE action='lease.active_rectified')<>false THEN
  RAISE EXCEPTION 'Correction audit erroneously claims financial movements changed'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: signed evidence required, no rent period rewrite, no direct edits, audit complete' AS result;
