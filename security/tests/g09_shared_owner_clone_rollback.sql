-- G09 isolated test for multi-owner payout arithmetic on restored QA tenant.
-- Append after migration candidate removing only its COMMIT; run as ONE SQL transaction.
-- Uses SET LOCAL ROLE (simulated JWT), NOT proof of 5 genuine Auth sessions.
-- EVERY fictitious owner, receipt amount and payout is rolled back.
DO $setup$
DECLARE v_org uuid;v_lease uuid;v_property uuid;v_primary uuid;v_actor uuid;
 v_second uuid;v_changed integer;
BEGIN
 SELECT o.id,l.id,l.property_id,l.owner_id INTO v_org,v_lease,v_property,v_primary
 FROM public.organizations o JOIN public.organization_billing_access b
 ON b.organization_id=o.id AND b.is_test
 JOIN public.leases l ON l.organization_id=o.id AND l.status='ACTIVE'
 WHERE o.slug='sistema-inmobiliario-jco' LIMIT 1;
 SELECT m.user_id INTO v_actor
 FROM public.organization_members m JOIN public.member_roles mr ON mr.organization_member_id=m.id
 JOIN public.roles r ON r.id=mr.role_id AND r.key='ORGANIZATION_OWNER'
 WHERE m.organization_id=v_org AND m.status='ACTIVE' LIMIT 1;
 IF v_org IS NULL OR v_lease IS NULL OR v_actor IS NULL
 OR (SELECT count(*) FROM public.property_ownerships WHERE property_id=v_property)<>1
 OR NOT EXISTS(SELECT 1 FROM public.property_ownerships
 WHERE property_id=v_property AND owner_id=v_primary AND ownership_percentage=100 AND is_primary)
 OR EXISTS(SELECT 1 FROM public.owner_statements WHERE lease_id=v_lease)
 THEN RAISE EXCEPTION 'G09 strictly isolated QA preflight mismatch'; END IF;

 INSERT INTO public.property_owners(organization_id,first_name,last_name)
 VALUES(v_org,'QA G09 Copropietaria','SOLO TRANSACCIÓN REVERSIBLE')
 RETURNING id INTO v_second;
 UPDATE public.property_ownerships SET ownership_percentage=60
 WHERE property_id=v_property AND owner_id=v_primary AND ownership_percentage=100;
 GET DIAGNOSTICS v_changed=ROW_COUNT;
 IF v_changed<>1 THEN RAISE EXCEPTION 'Failed first share allocation'; END IF;
 INSERT INTO public.property_ownerships(property_id,owner_id,ownership_percentage,is_primary)
 VALUES(v_property,v_second,40,false);

 UPDATE public.rent_payments SET paid_amount=100.01,status='PARTIAL',paid_at=now()
 WHERE organization_id=v_org AND lease_id=v_lease AND period_month='2026-10-01'
 AND paid_amount=0 AND status='PENDING' AND expected_amount>=100.01;
 GET DIAGNOSTICS v_changed=ROW_COUNT;
 IF v_changed<>1 THEN RAISE EXCEPTION 'QA receipt fixture changed unexpectedly'; END IF;

 PERFORM set_config('jco.g09.org',v_org::text,true);
 PERFORM set_config('jco.g09.lease',v_lease::text,true);
 PERFORM set_config('jco.g09.actor',v_actor::text,true);
 PERFORM set_config('jco.g09.property',v_property::text,true);
 PERFORM set_config('jco.g09.primary',v_primary::text,true);
 PERFORM set_config('jco.g09.second',v_second::text,true);
END $setup$;

SET LOCAL ROLE authenticated;
DO $test$
DECLARE v_org uuid:=current_setting('jco.g09.org')::uuid;
 v_lease uuid:=current_setting('jco.g09.lease')::uuid;
 v_actor uuid:=current_setting('jco.g09.actor')::uuid;
 v_property uuid:=current_setting('jco.g09.property')::uuid;
 v_count integer;v_tot record;v_rec record;v_payout uuid;
 v_other uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);

 -- The old single-owner creator MUST reject 100% to a 60% primary.
 BEGIN
  PERFORM public.create_owner_draft_statement(v_org,v_lease,'2026-10-01',10.01,2.02);
  RAISE EXCEPTION 'G09 FAIL: old RPC allocated all shared rent to primary owner';
 EXCEPTION WHEN check_violation THEN NULL;
 END;

 SELECT count(*) INTO v_count FROM public.create_owner_shared_drafts(
   v_org,v_lease,'2026-10-01',10.01,2.02);
 IF v_count<>2 THEN RAISE EXCEPTION 'Expected exactly two owner statements'; END IF;

 SELECT sum(gross_income) AS gross,sum(commission_amount) commission,
  sum(tax_amount) tax,sum(net_amount) net,count(DISTINCT owner_id) unique_owners
 INTO v_tot FROM public.owner_statements
 WHERE organization_id=v_org AND lease_id=v_lease AND period_month='2026-10-01';
 IF v_tot.gross<>100.01 OR v_tot.commission<>10.01 OR v_tot.tax<>2.02
 OR v_tot.net<>87.98 OR v_tot.unique_owners<>2
 THEN RAISE EXCEPTION 'G09 penny split differs: %, %, %, %',
  v_tot.gross,v_tot.commission,v_tot.tax,v_tot.net;
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.owner_statements s
  WHERE s.lease_id=v_lease AND s.owner_id=current_setting('jco.g09.primary')::uuid
  AND s.gross_income=60.01
 ) OR NOT EXISTS (
  SELECT 1 FROM public.owner_statements s
  WHERE s.lease_id=v_lease AND s.owner_id=current_setting('jco.g09.second')::uuid
  AND s.gross_income=40.00
 ) THEN RAISE EXCEPTION 'G09 deterministic 60/40 cents incorrect'; END IF;

 -- Reconcile MUST retain only its owner's allocated amount.
 FOR v_rec IN SELECT id,gross_income,net_amount FROM public.owner_statements
  WHERE lease_id=v_lease AND organization_id=v_org ORDER BY id
 LOOP
  IF public.reconcile_owner_draft_statement_audited(v_org,v_rec.id)<>v_rec.net_amount THEN
   RAISE EXCEPTION 'G09 reconciliation changed split net or allocations';
  END IF;
  IF (SELECT gross_income FROM public.owner_statements WHERE id=v_rec.id)<>v_rec.gross_income
  THEN RAISE EXCEPTION 'G09 reconciliation duplicated total income'; END IF;
 END LOOP;

 -- Retrying the same period must not create a new owner bill.
 BEGIN
  PERFORM public.create_owner_shared_drafts(v_org,v_lease,'2026-10-01',10.01,2.02);
  RAISE EXCEPTION 'G09 FAIL: duplicate statements allowed';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;

 -- Invalid sum of shares rejected independently of amount.
 UPDATE public.property_ownerships SET ownership_percentage=50
 WHERE property_id=v_property AND owner_id=current_setting('jco.g09.primary')::uuid;
 BEGIN
  PERFORM public.create_owner_shared_drafts(v_org,v_lease,'2026-09-01',10.01,2.02);
  RAISE EXCEPTION 'G09 FAIL: percentages totaling 90 allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 UPDATE public.property_ownerships SET ownership_percentage=60
 WHERE property_id=v_property AND owner_id=current_setting('jco.g09.primary')::uuid;

 SELECT id INTO v_other FROM public.organizations
 WHERE slug='qa-finance-96-foreign-20261113';
 IF v_other IS NULL THEN RAISE EXCEPTION 'G09 foreign QA org not installed'; END IF;
 BEGIN
  PERFORM public.create_owner_shared_drafts(v_other,v_lease,'2026-10-01',10.01,2.02);
  RAISE EXCEPTION 'G09 FAIL: cross-tenant allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;

 -- Even with a real database state GENERATED/PAID, this is only fake evidence.
 FOR v_rec IN SELECT id,net_amount FROM public.owner_statements
 WHERE lease_id=v_lease AND organization_id=v_org ORDER BY id
 LOOP
  PERFORM public.admin_issue_owner_statement(v_rec.id,v_org);
  v_payout:=public.admin_record_owner_payout(v_rec.id,v_org,v_rec.net_amount,
   current_date,'TRANSFER','QA-G09-NO-MONEY','QA-G09-EVIDENCE-NOT-BANK');
  IF v_payout IS NULL OR (SELECT status FROM public.owner_statements WHERE id=v_rec.id)<>'PAID'
  THEN RAISE EXCEPTION 'G09 fictional payout record did not reconcile'; END IF;
 END LOOP;
 IF (SELECT coalesce(sum(amount),0) FROM public.owner_statement_payouts
 WHERE organization_id=v_org AND statement_id IN
  (SELECT id FROM public.owner_statements WHERE lease_id=v_lease))<>87.98
 THEN RAISE EXCEPTION 'G09 recorded payouts exceed/under net'; END IF;
 IF (SELECT count(*) FROM public.audit_log WHERE organization_id=v_org
  AND action='owner_statement.shared_draft_created'
  AND entity_id IN (SELECT id FROM public.owner_statements WHERE lease_id=v_lease))<>2
 THEN RAISE EXCEPTION 'G09 missing shared draft audit trail'; END IF;
 PERFORM set_config('jco.g09.pass','yes',true);
END $test$;
RESET ROLE;
DO $check$
BEGIN
 IF current_setting('jco.g09.pass',true)<>'yes'
 THEN RAISE EXCEPTION 'G09 test not completed'; END IF;
END $check$;
ROLLBACK;
SELECT 'PASS: two owners 60/40 exact cents, isolated drafts, reconciliation, duplicate/tenant/repartition denied, payout audit, ALL ROLLED BACK' AS evidence;
