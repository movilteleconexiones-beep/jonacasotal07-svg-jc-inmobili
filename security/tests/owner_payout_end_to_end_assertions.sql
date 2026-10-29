-- Run ONLY in the isolated CI database after fixture and the real migration.
-- No network, no actual bank transfers, no real customer or production records.
BEGIN;

CREATE FUNCTION pg_temp.expect_sqlstate(statement text, wanted text, label text)
RETURNS void LANGUAGE plpgsql AS $body$
DECLARE got text := null;
BEGIN
 BEGIN
   EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
   got := SQLSTATE;
 END;
 IF got IS DISTINCT FROM wanted THEN
   RAISE EXCEPTION 'Expected SQLSTATE % but received % for %',wanted,COALESCE(got,'SUCCESS'),label;
 END IF;
END $body$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);

-- External client cannot fake a payout, even with a known statement ID.
SELECT pg_temp.expect_sqlstate($s$
 SELECT public.admin_record_owner_payout(
 '44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111',
 100,current_date,'TRANSFER','client-forged-001','owner-payouts/fake.pdf')
$s$,'42501','external client cannot execute payout');
SELECT pg_temp.expect_sqlstate($s$
 INSERT INTO public.owner_statement_payouts(
 organization_id,statement_id,amount,paid_on,payment_method,
 payment_reference,evidence_reference,recorded_by)
 VALUES('11111111-1111-4111-8111-111111111111',
 '44444444-4444-4444-8444-444444444444',
 100,current_date,'TRANSFER','client-direct-001',
 'owner-payouts/fake.pdf','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
$s$,'42501','authenticated cannot insert a forged direct payout');
SELECT public.test_assert((SELECT count(*) FROM public.owner_statement_payouts)=0,
 'client cannot read the payout ledger');

-- Different tenant manager cannot pay a foreign statement or see its records.
SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
SELECT pg_temp.expect_sqlstate($s$
 SELECT public.admin_record_owner_payout(
 '44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111',
 100,current_date,'TRANSFER','other-tenant-001','owner-payouts/fake.pdf')
$s$,'42501','tenant B cannot pay tenant A owner');
SELECT public.test_assert((SELECT count(*) FROM public.owner_statement_payouts)=0,
 'manager from another tenant cannot browse payout ledger');

-- Tenant A manager: invalid receipt metadata and draft statements fail closed.
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
SELECT pg_temp.expect_sqlstate($s$
 SELECT public.admin_record_owner_payout(
 '66666666-6666-4666-8666-666666666666',
 '11111111-1111-4111-8111-111111111111',
 100,current_date,'TRANSFER','draft-owner-001','owner-payouts/proof.pdf')
$s$,'23514','draft cannot receive a payout');
SELECT pg_temp.expect_sqlstate($s$
 SELECT public.admin_record_owner_payout(
 '44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111',
 100,'2999-01-01','TRANSFER','future-owner-001','owner-payouts/proof.pdf')
$s$,'23514','future paid date rejected');
SELECT pg_temp.expect_sqlstate($s$
 SELECT public.admin_record_owner_payout(
 '44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111',
 100,current_date,'INVALID','method-owner-001','owner-payouts/proof.pdf')
$s$,'23514','invalid payment method rejected');
SELECT pg_temp.expect_sqlstate($s$
 SELECT public.admin_record_owner_payout(
 '44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111',
 100,current_date,'TRANSFER','missing-evidence-001','')
$s$,'23514','missing evidence reference rejected');
SELECT pg_temp.expect_sqlstate($s$
 SELECT public.admin_record_owner_payout(
 '55555555-5555-4555-8555-555555555555',
 '11111111-1111-4111-8111-111111111111',
 100,current_date,'TRANSFER','foreign-owner-001','owner-payouts/proof.pdf')
$s$,'P0002','foreign statement is not addressable as own');
SELECT public.test_assert((SELECT count(*) FROM public.owner_statement_payouts)=0,
 'invalid attempts cannot create payout records');

-- Partial payment, audited by user id, must preserve GENERATED status.
SELECT public.admin_record_owner_payout(
 '44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111',
 390000,current_date,'TRANSFER','owner-transfer-001',
 'owner-payouts/fixtures/partial.pdf');
SELECT public.test_assert(
 (SELECT coalesce(sum(amount),0) FROM public.owner_statement_payouts)=390000
 AND (SELECT count(*) FROM public.owner_statement_payouts WHERE recorded_by=(SELECT auth.uid()))=1
 AND (SELECT status FROM public.owner_statements
      WHERE id='44444444-4444-4444-8444-444444444444')='GENERATED',
 'partial payout must not settle the entire owner statement');

-- Duplicate reference cannot create double payout. Overpayment cannot pass.
SELECT pg_temp.expect_sqlstate($s$
 SELECT public.admin_record_owner_payout(
 '44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111',
 390000,current_date,'TRANSFER','owner-transfer-001',
 'owner-payouts/fixtures/retry.pdf')
$s$,'23505','duplicate payout reference is blocked');
SELECT pg_temp.expect_sqlstate($s$
 SELECT public.admin_record_owner_payout(
 '44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111',
 1000001,current_date,'TRANSFER','owner-transfer-overpay',
 'owner-payouts/fixtures/overpay.pdf')
$s$,'23514','amount above remaining balance rejected');
SELECT public.test_assert(
 (SELECT count(*) FROM public.owner_statement_payouts)=1,
 'failed retries cannot create extra payouts');

-- Final installment equals exactly 1,390,000 net and settles once.
SELECT public.admin_record_owner_payout(
 '44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111',
 1000000,current_date,'TRANSFER','owner-transfer-002',
 'owner-payouts/fixtures/final.pdf');
SELECT public.test_assert(
 (SELECT count(*) FROM public.owner_statement_payouts)=2
 AND (SELECT sum(amount) FROM public.owner_statement_payouts)=1390000
 AND (SELECT status FROM public.owner_statements
      WHERE id='44444444-4444-4444-8444-444444444444')='PAID',
 'full payout must settle exactly the authorized net once');

SELECT pg_temp.expect_sqlstate($s$
 SELECT public.admin_record_owner_payout(
 '44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111',
 1,current_date,'TRANSFER','owner-transfer-003',
 'owner-payouts/fixtures/extra.pdf')
$s$,'23514','fully settled statement cannot receive another payment');

SELECT set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
SELECT public.test_assert((SELECT count(*) FROM public.owner_statement_payouts)=0,
 'tenant B manager still cannot see payout records of A');
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
SELECT public.test_assert((SELECT count(*) FROM public.owner_statement_payouts)=0,
 'external client still cannot see internal ledger after issuance');

RESET ROLE;
SELECT public.test_assert(
 (SELECT count(*) FROM public.owner_statement_payouts)=2
 AND (SELECT count(*) FROM public.owner_statements WHERE status='PAID')=1
 AND (SELECT count(*) FROM public.owner_statements WHERE status='GENERATED')=1
 AND (SELECT count(*) FROM public.owner_statements WHERE status='DRAFT')=1,
 'global postconditions must preserve other tenant and draft statement');
ROLLBACK;
