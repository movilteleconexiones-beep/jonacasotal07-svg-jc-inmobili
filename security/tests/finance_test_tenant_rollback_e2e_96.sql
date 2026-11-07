-- #96 Financial end-to-end hosted regression, 2026-11-07.
-- Restricted to existing TEST tenant. All writes are scoped to BEGIN..ROLLBACK.
-- Never use for real customer accounts, production bank transfers or Wompi.
-- Proven against the active Supabase schema on 2026-11-07: PASS.
-- No impersonation of a genuine login is claimed: authenticated role/JWT are simulated.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';

DO $qa$
DECLARE org uuid; actor uuid; lease uuid;
BEGIN
 SELECT o.id,m.user_id,l.id INTO org,actor,lease
 FROM public.organizations o
 JOIN public.organization_billing_access ba ON ba.organization_id=o.id AND ba.is_test
 JOIN public.organization_members m ON m.organization_id=o.id AND m.status='ACTIVE'
 JOIN public.leases l ON l.organization_id=o.id AND l.status='ACTIVE'
 WHERE o.slug='sistema-inmobiliario-jco'
   AND l.start_date<='2026-11-01'
   AND (l.end_date IS NULL OR l.end_date>='2026-11-01')
 LIMIT 1;
 IF org IS NULL OR actor IS NULL OR lease IS NULL
 THEN RAISE EXCEPTION 'Missing existing active lease in designated test tenant'; END IF;
 IF NOT jco_private.operational_access(org)
 THEN RAISE EXCEPTION 'The designated test tenant has no operational access'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('jco.qa.org',org::text,true);
 PERFORM set_config('jco.qa.lease',lease::text,true);
END $qa$;

SET LOCAL ROLE authenticated;
DO $finance$
DECLARE
 org uuid:=current_setting('jco.qa.org')::uuid;
 lease uuid:=current_setting('jco.qa.lease')::uuid;
 payment uuid; receipt uuid; repeated uuid; statement uuid;
 expected numeric; commission numeric; first_part numeric; net numeric;
 denied boolean; request uuid:=gen_random_uuid();
BEGIN
 IF NOT public.has_org_permission(org,'rent_payments.create')
 OR NOT public.has_org_permission(org,'owner_statements.create')
 THEN RAISE EXCEPTION 'Test agency actor lacks financial permissions'; END IF;

 -- Lease terms and amendments, not a hard-coded canon, determine the obligation.
 payment:=public.create_tenant_rent_period(org,lease,'2026-11-01');
 SELECT expected_amount INTO expected
 FROM public.rent_payments WHERE id=payment AND organization_id=org;
 IF expected IS NULL OR expected<=1
 THEN RAISE EXCEPTION 'Invalid effective scheduled rent'; END IF;

 first_part:=round(expected*0.3,2);
 receipt:=public.record_tenant_rent_receipt(
  org,payment,first_part,'BANK_TRANSFER','QA-ROLLBACK-REC-001',request);
 repeated:=public.record_tenant_rent_receipt(
  org,payment,first_part,'BANK_TRANSFER','QA-ROLLBACK-REC-001',request);
 IF receipt IS DISTINCT FROM repeated OR
 (SELECT paid_amount FROM public.rent_payments WHERE id=payment)<>first_part
 THEN RAISE EXCEPTION 'Rent receipt idempotency regression'; END IF;

 PERFORM public.record_tenant_rent_receipt(org,payment,expected-first_part,
  'CASH','QA-ROLLBACK-REC-002',gen_random_uuid());
 IF (SELECT paid_amount FROM public.rent_payments WHERE id=payment)<>expected
 OR (SELECT status FROM public.rent_payments WHERE id=payment)<>'PAID'
 THEN RAISE EXCEPTION 'Paid rent status/amount inconsistent'; END IF;

 denied:=false;
 BEGIN
  PERFORM public.record_tenant_rent_receipt(
   org,payment,1,'CASH','QA-ROLLBACK-OVERPAY',gen_random_uuid());
 EXCEPTION WHEN SQLSTATE '23514' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Overpayment was accepted'; END IF;

 commission:=round(expected*0.10,2);
 statement:=public.create_owner_draft_statement(
  org,lease,'2026-11-01',commission,30000);
 INSERT INTO public.owner_statement_deductions(
   organization_id,statement_id,charge_date,category,responsible_party,
   amount,description,support_reference)
 VALUES
  (org,statement,'2026-11-01','WATER','OWNER',120000,
   'QA owner-borne water','QA-ROLLBACK-OWNER'),
  (org,statement,'2026-11-01','ELECTRICITY','TENANT',70000,
   'QA tenant-borne energy','QA-ROLLBACK-TENANT');

 denied:=false;
 BEGIN PERFORM public.reconcile_owner_draft_statement(org,statement);
 EXCEPTION WHEN SQLSTATE '23514' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Reconciled an unapproved deduction'; END IF;

 UPDATE public.owner_statement_deductions
 SET status='APPROVED' WHERE statement_id=statement AND organization_id=org;
 net:=public.reconcile_owner_draft_statement_audited(org,statement);
 IF net IS DISTINCT FROM expected-commission-30000-120000
 THEN RAISE EXCEPTION
  'Owner net must exclude tenant utilities; obligation %, net %',expected,net; END IF;

 IF (SELECT count(*) FROM public.rent_receipts WHERE rent_payment_id=payment)<>2
 THEN RAISE EXCEPTION 'Duplicate receipt event after idempotent retry'; END IF;
END $finance$;
RESET ROLE;
ROLLBACK;
SELECT
 CASE
 WHEN NOT EXISTS(SELECT 1 FROM public.rent_receipts
   WHERE support_reference IN ('QA-ROLLBACK-REC-001','QA-ROLLBACK-REC-002'))
 AND NOT EXISTS(SELECT 1 FROM public.owner_statement_deductions
   WHERE support_reference IN ('QA-ROLLBACK-OWNER','QA-ROLLBACK-TENANT'))
 THEN 'PASS: hosted test-tenant financial flow, receipts, authorized deductions, owner net and full rollback'
 ELSE 'FAIL: synthetic financial records persisted'
 END AS evidence;
