-- Verify server authorization and paid-money immutability in PostgreSQL 17.
SELECT set_config('jco_test.actor','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
SET ROLE authenticated;
DO $assert$
DECLARE result uuid; rejected boolean; review_id uuid;
BEGIN
 -- Agent may correct a PENDING, unpaid commission with exact rate times basis.
 result:=public.edit_unpaid_commission(
   '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-000000000001',
   '11111111-2222-4333-8444-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'AGENT',10,1800000,null,'Corrected with evidence',
   'Fix mistaken pending commission base');
 IF result IS NULL OR (SELECT amount FROM public.commissions WHERE id=result)<>180000 THEN
   RAISE EXCEPTION 'PENDING correction failed'; END IF;
 -- Direct client DML must be forbidden even with an overly permissive legacy RLS policy.
 rejected:=false;
 BEGIN
  UPDATE public.commissions SET amount=0 WHERE id='11111111-1111-4111-8111-000000000001';
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Direct commission UPDATE was allowed'; END IF;
 rejected:=false;
 BEGIN
  DELETE FROM public.commissions WHERE id='11111111-1111-4111-8111-000000000003';
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Direct commission DELETE was allowed'; END IF;
 -- Agents cannot edit approved/payable liabilities or mark them paid.
 rejected:=false;
 BEGIN
  PERFORM public.edit_unpaid_commission('11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-000000000002',
   '11111111-2222-4333-8444-111111111111',null,'AGENT',10,1800000,
   null,'No change','Agent tried editing payable amount');
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Agent edited PAYABLE money'; END IF;
 rejected:=false;
 BEGIN
  PERFORM public.set_commission_status_audited(
    '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-000000000002',
    'PAID','Agent attempted approval of real payment');
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Agent marked commission PAID'; END IF;
 -- Paid edits/cancellations require pending approval request, never direct mutation.
 rejected:=false;
 BEGIN
  PERFORM public.cancel_unpaid_commission('11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-000000000003','Try to cancel historical paid commission');
 EXCEPTION WHEN check_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Paid commission cancelled directly'; END IF;
 review_id:=public.request_paid_commission_review(
   '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-000000000003',
   'EDIT','Paid amount requires documented correction',10,1800000);
 IF review_id IS NULL THEN RAISE EXCEPTION 'Review missing'; END IF;
 rejected:=false;
 BEGIN
  PERFORM public.request_paid_commission_review(
   '11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-000000000003',
   'VOID','Duplicate pending review with independent approval');
 EXCEPTION WHEN unique_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Duplicate pending review allowed'; END IF;
 rejected:=false;
 BEGIN
  PERFORM public.decide_paid_commission_review(
   '11111111-1111-4111-8111-111111111111',review_id,
   'APPROVED','Trying to approve own paid commission review');
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Agent approved his own request'; END IF;
 -- Cannot operate on an unrelated tenant.
 rejected:=false;
 BEGIN
  PERFORM public.cancel_unpaid_commission('22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-000000000001','Cross-tenant attempt on other agency');
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Cross-tenant cancellation was allowed'; END IF;
END $assert$;
RESET ROLE;
SELECT set_config('jco_test.actor','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
SET ROLE authenticated;
DO $assert$
DECLARE decision_id uuid; rejected boolean:=false;
BEGIN
 -- An independent admin may approve review, preserving original paid money.
 SELECT id INTO decision_id FROM public.commission_review_requests
 WHERE commission_id='11111111-1111-4111-8111-000000000003';
 PERFORM public.decide_paid_commission_review(
   '11111111-1111-4111-8111-111111111111',decision_id,'APPROVED',
   'Approved independent financial reconciliation and compensating entry');
 IF (SELECT status FROM public.commission_review_requests WHERE id=decision_id)<>'APPROVED' THEN
   RAISE EXCEPTION 'Approval not recorded'; END IF;
 IF (SELECT amount FROM public.commissions
   WHERE id='11111111-1111-4111-8111-000000000003')<>1800000
 OR (SELECT status FROM public.commissions
   WHERE id='11111111-1111-4111-8111-000000000003')<>'PAID' THEN
   RAISE EXCEPTION 'Approval rewrote already-paid money'; END IF;
 -- Manager may cancel a PAYABLE unpaid obligation, never erase it.
 PERFORM public.cancel_unpaid_commission('11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-000000000002','Erroneous payable commission, no transfer executed');
 IF (SELECT status FROM public.commissions
   WHERE id='11111111-1111-4111-8111-000000000002')<>'CANCELLED' THEN
   RAISE EXCEPTION 'Soft cancellation failed'; END IF;
 rejected:=false;
 BEGIN
  PERFORM public.decide_paid_commission_review(
   '11111111-1111-4111-8111-111111111111',decision_id,'APPROVED',
   'Repeated approval must not be allowed');
 EXCEPTION WHEN check_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Second approval allowed'; END IF;
END $assert$;
RESET ROLE;

DO $assert$
BEGIN
 IF has_table_privilege('authenticated','public.commissions','UPDATE')
 OR has_table_privilege('authenticated','public.commissions','DELETE')
 OR has_function_privilege('anon','public.cancel_unpaid_commission(uuid,uuid,text)','EXECUTE')
 OR has_table_privilege('authenticated','public.commission_review_requests','UPDATE')
 THEN RAISE EXCEPTION 'Unsafe browser grants remain'; END IF;
 IF (SELECT count(*) FROM public.commissions)<>4 THEN
   RAISE EXCEPTION 'One or more commission histories were deleted'; END IF;
 IF (SELECT count(*) FROM public.audit_log WHERE action LIKE 'commissions.%')<4 THEN
   RAISE EXCEPTION 'Correction, review and decision audit events missing'; END IF;
 IF (SELECT count(*) FROM public.commission_review_requests)<>1 THEN
   RAISE EXCEPTION 'Review request history was destroyed'; END IF;
END $assert$;
SELECT 'PASS: agent pending edit, admin decision, paid immutability, RLS bypass closure' AS result;
