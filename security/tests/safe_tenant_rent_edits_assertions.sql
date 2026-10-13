-- Isolated finance fixtures: lease PRUEBA-A exists, with October fully paid
-- and a draft owner statement. No production rows participate.
SELECT set_config('jco_test.organization','11111111-1111-4111-8111-111111111111',false);
SELECT set_config('jco_test.actor','10101010-1010-4010-8010-101010101010',false);
SET ROLE authenticated;

DO $check$
DECLARE
 amendment uuid;
 same_amendment uuid;
 january_payment uuid;
 january_expected numeric;
 corrected numeric;
 review uuid;
 refused boolean;
BEGIN
 amendment:=public.schedule_lease_rent_amendment(
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  '2026-12-01',1750000,
  'Signed rent increase with tenant effective December',
  'OTROSI-DICIEMBRE-2026',
  '55555555-aaaa-4aaa-8aaa-555555555555'
 );
 same_amendment:=public.schedule_lease_rent_amendment(
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  '2026-12-01',1750000,
  'Signed rent increase with tenant effective December',
  'OTROSI-DICIEMBRE-2026',
  '55555555-aaaa-4aaa-8aaa-555555555555'
 );
 IF same_amendment<>amendment THEN RAISE EXCEPTION 'Same request key created duplicate'; END IF;

 january_payment:=public.create_tenant_rent_period(
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333','2027-01-01');
 SELECT expected_amount INTO january_expected FROM public.rent_payments WHERE id=january_payment;
 IF january_expected<>1750000 THEN RAISE EXCEPTION 'Amended rate was not used: %',january_expected; END IF;

 corrected:=public.correct_unpaid_rent_period(
  '11111111-1111-4111-8111-111111111111',
  january_payment,1800000,'Correction of unpaid billing for January');
 IF corrected<>1800000 THEN RAISE EXCEPTION 'Unpaid obligation edit did not persist'; END IF;

 refused:=false;
 BEGIN
  PERFORM public.correct_unpaid_rent_period(
   '11111111-1111-4111-8111-111111111111',
   (SELECT id FROM public.rent_payments WHERE period_month='2026-10-01' LIMIT 1),
   1700000,'Tampering with paid October balance');
 EXCEPTION WHEN check_violation THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'PAID period was edited'; END IF;

 review:=public.request_paid_rent_review(
  '11111111-1111-4111-8111-111111111111',
  (SELECT id FROM public.rent_payments WHERE period_month='2026-10-01' LIMIT 1),
  'Request review of October payment but do not alter the original receipt');
 IF review IS NULL THEN RAISE EXCEPTION 'Missing review audit event'; END IF;

 refused:=false;
 BEGIN
  PERFORM public.schedule_lease_rent_amendment(
   '11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','2027-01-01',1900000,
   'Reject adjustment where obligation already exists','OTROSI-ENERO-2027',
   '55555555-bbbb-4bbb-8bbb-555555555555');
 EXCEPTION WHEN check_violation THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'Existing generated period was overwritten'; END IF;

 IF (SELECT COUNT(*) FROM public.lease_rent_amendments)<>1 OR
    (SELECT COUNT(*) FROM public.rent_receipts)<>0 OR
    (SELECT COUNT(*) FROM public.rent_payments
       WHERE period_month='2026-10-01' AND paid_amount=1600000 AND status='PAID')<>1 OR
    (SELECT COUNT(*) FROM public.owner_statements
       WHERE lease_id='33333333-3333-4333-8333-333333333333'
         AND period_month='2026-10-01')<>1 THEN
   RAISE EXCEPTION 'Rehearsal mutated paid receipt history or statement';
 END IF;
 IF (SELECT COUNT(*) FROM public.audit_log
   WHERE action IN ('leases.rent_amendment_scheduled',
      'rent_period.amount_corrected','rent_period.review_requested'))<>3 THEN
   RAISE EXCEPTION 'Missing audit events'; END IF;
END
$check$;

-- No tenant agent may edit a contract or unpaid obligation even when
-- the member has general rent permission.
SELECT set_config('jco_test.actor','20202020-2020-4020-8020-202020202020',false);
DO $test$
DECLARE refused boolean:=false;
BEGIN
 BEGIN
  PERFORM public.correct_unpaid_rent_period(
   '11111111-1111-4111-8111-111111111111',
   (SELECT id FROM public.rent_payments WHERE period_month='2027-01-01' LIMIT 1),
   1900000,'Agent attempted unauthorized correction');
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'Agent was permitted to edit money'; END IF;
END
$test$;

SELECT set_config('jco_test.actor','10101010-1010-4010-8010-101010101010',false);
DO $test$
DECLARE refused boolean:=false;
BEGIN
 BEGIN
  PERFORM public.request_paid_rent_review(
   '22222222-2222-4222-8222-222222222222',
   (SELECT id FROM public.rent_payments WHERE period_month='2026-10-01' LIMIT 1),
   'Attempt to submit another company review');
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'Cross-tenant review was permitted'; END IF;
END
$test$;
RESET ROLE;

DO $final$
BEGIN
 IF has_table_privilege('authenticated','public.lease_rent_amendments','INSERT') OR
    has_table_privilege('anon','public.lease_rent_amendments','SELECT') OR
    has_function_privilege('anon','public.correct_unpaid_rent_period(uuid,uuid,numeric,text)','EXECUTE') THEN
   RAISE EXCEPTION 'Unsafe public grant remains'; END IF;
END
$final$;
SELECT 'PASS audited prospective canon, pending obligation edit, immutable paid rent and tenant isolation' result;
