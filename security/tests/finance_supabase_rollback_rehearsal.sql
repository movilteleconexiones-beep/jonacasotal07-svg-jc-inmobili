-- Real schema and real member permissions, with temporary business records.
-- All test writes are rolled back. No auth accounts, emails or payments.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $setup$
DECLARE actor uuid; org uuid; member uuid;
BEGIN
 SELECT m.user_id,m.organization_id,m.id INTO actor,org,member
 FROM public.organization_members m
 JOIN public.organization_billing_access b ON b.organization_id=m.organization_id
 WHERE m.status='ACTIVE' AND NOT b.requires_payment
   AND EXISTS(SELECT 1 FROM public.member_roles mr JOIN public.roles r ON r.id=mr.role_id
     WHERE mr.organization_member_id=m.id AND r.active AND r.key IN ('ADMIN','ORGANIZATION_OWNER'))
 LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'No authorized internal rehearsal member available'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('jco.rehearsal.org',org::text,true);
 PERFORM set_config('jco.rehearsal.member',member::text,true);
END
$setup$;
SET LOCAL ROLE authenticated;
DO $flow$
DECLARE
 org uuid:=current_setting('jco.rehearsal.org')::uuid;
 property uuid; tenant uuid; owner uuid; lease uuid; period uuid; statement uuid;
 receipt uuid; repeated uuid; request uuid:=gen_random_uuid(); net numeric; rejected boolean;
BEGIN
 IF NOT public.has_org_permission(org,'leases.create') OR
    NOT public.has_org_permission(org,'leases.edit') OR
    NOT public.has_org_permission(org,'rent_payments.create') OR
    NOT public.has_org_permission(org,'owner_statements.create') THEN
  RAISE EXCEPTION 'Real permission checks do not allow the intended accounting workflow';
 END IF;
 INSERT INTO public.properties(organization_id,code,title,operation_type,property_type,currency)
 VALUES(org,'REHEARSAL-'||gen_random_uuid(),'Ensayo temporal financiero','RENT','APARTMENT','COP')
 RETURNING id INTO property;
 INSERT INTO public.contacts(organization_id,first_name) VALUES(org,'Inquilino temporal de ensayo') RETURNING id INTO tenant;
 INSERT INTO public.property_owners(organization_id,first_name) VALUES(org,'Propietario temporal de ensayo') RETURNING id INTO owner;
 INSERT INTO public.leases(organization_id,property_id,tenant_id,owner_id,contract_number,
   monthly_rent,start_date,end_date,status)
 VALUES(org,property,tenant,owner,'ENSAYO-ROLLBACK',1600000,'2026-09-01','2027-08-31','DRAFT')
 RETURNING id INTO lease;
 UPDATE public.leases SET status='ACTIVE' WHERE id=lease AND organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION 'Authorized member could not activate the contract'; END IF;
 period:=public.create_tenant_rent_period(org,lease,'2026-10-01');
 receipt:=public.record_tenant_rent_receipt(org,period,600000,'BANK_TRANSFER','ENSAYO-ABONO-001',request);
 repeated:=public.record_tenant_rent_receipt(org,period,600000,'BANK_TRANSFER','ENSAYO-ABONO-001',request);
 IF receipt<>repeated OR (SELECT paid_amount FROM public.rent_payments WHERE id=period)<>600000 THEN
  RAISE EXCEPTION 'Receipt retry was not idempotent'; END IF;
 PERFORM public.record_tenant_rent_receipt(org,period,1000000,'CASH','ENSAYO-ABONO-002',gen_random_uuid());
 rejected:=false;
 BEGIN PERFORM public.record_tenant_rent_receipt(org,period,1,'CASH','ENSAYO-EXCESO',gen_random_uuid());
 EXCEPTION WHEN check_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Overpayment was accepted'; END IF;
 statement:=public.create_owner_draft_statement(org,lease,'2026-10-01',160000,30000);
 INSERT INTO public.owner_statement_deductions
  (organization_id,statement_id,charge_date,category,responsible_party,amount,description,support_reference)
 VALUES (org,statement,'2026-10-01','WATER','OWNER',120000,'Agua asumida por el propietario','ENSAYO-AGUA'),
        (org,statement,'2026-10-01','ELECTRICITY','TENANT',70000,'Energía asumida por el inquilino','ENSAYO-ENERGIA');
 rejected:=false;
 BEGIN PERFORM public.reconcile_owner_draft_statement(org,statement);
 EXCEPTION WHEN check_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Unapproved deductions were reconciled'; END IF;
 UPDATE public.owner_statement_deductions SET status='APPROVED' WHERE statement_id=statement AND organization_id=org;
 net:=public.reconcile_owner_draft_statement(org,statement);
 IF net<>1290000 THEN RAISE EXCEPTION 'Tenant utilities were incorrectly deducted from owner net'; END IF;
 IF (SELECT count(*) FROM public.rent_receipts WHERE rent_payment_id=period)<>2 THEN
  RAISE EXCEPTION 'Immutable receipt event count differs from actual credits'; END IF;
 rejected:=false;
 BEGIN UPDATE public.rent_payments SET paid_amount=0 WHERE id=period;
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Direct rent aggregate tampering was allowed'; END IF;
 rejected:=false;
 BEGIN UPDATE public.owner_statements SET net_amount=1 WHERE id=statement;
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Direct owner net tampering was allowed'; END IF;
 rejected:=false;
 BEGIN PERFORM public.create_tenant_rent_period(gen_random_uuid(),lease,'2026-11-01');
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Cross-organization RPC accepted the member'; END IF;
 PERFORM set_config('jco.rehearsal.lease',lease::text,true);
END
$flow$;
RESET ROLE;

-- A DENY override on the real member must defeat all assigned admin roles.
INSERT INTO public.member_permissions(organization_member_id,permission_id,effect)
 SELECT current_setting('jco.rehearsal.member')::uuid,id,'DENY'
 FROM public.permissions WHERE key='rent_payments.create'
 ON CONFLICT(organization_member_id,permission_id) DO UPDATE SET effect='DENY';
SET LOCAL ROLE authenticated;
DO $denial$
DECLARE rejected boolean:=false;
BEGIN
 BEGIN
  PERFORM public.create_tenant_rent_period(current_setting('jco.rehearsal.org')::uuid,
    current_setting('jco.rehearsal.lease')::uuid,'2026-11-01');
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Member lacking rent_payments.create created a charge'; END IF;
END
$denial$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: actual member flow, retry, overpayment, deduction net, direct write protection and DENY; all records rolled back' AS result;
