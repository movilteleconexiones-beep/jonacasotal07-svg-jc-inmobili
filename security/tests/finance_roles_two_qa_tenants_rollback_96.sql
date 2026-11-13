-- #96 G08/G07 hosted finance permissions — CLONE ONLY (NOT a migration).
-- Reproduces 25 RPC authorization checks on the restored, isolated TEST tenant.
-- Absolutely do not run against production. No authenticated browser session is created.
-- All test role assignments and any writes are reverted by the closing ROLLBACK.
-- For actual JWT / UI validation use separate real test identities.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='35s';

DO $fixture$
DECLARE test_org uuid; member_id uuid; actor_id uuid; foreign_org uuid;
BEGIN
  -- Additional hard guard: the isolated recovery clone has G07 schema
  -- and >=109 migrations. Production lacks this schema.
  IF to_regclass('private.consignment_policy_receipts') IS NULL OR
     (SELECT COUNT(*) FROM supabase_migrations.schema_migrations)<109 THEN
    RAISE EXCEPTION 'CLONE ONLY: missing isolated recovery schema';
  END IF;
  SELECT o.id,m.id,m.user_id INTO STRICT test_org,member_id,actor_id
  FROM public.organizations o
  JOIN public.organization_billing_access ba ON ba.organization_id=o.id AND ba.is_test
  JOIN public.organization_members m ON m.organization_id=o.id AND m.status='ACTIVE'
  LEFT JOIN public.platform_admins pa ON pa.user_id=m.user_id AND pa.active
  WHERE o.slug='sistema-inmobiliario-jco' AND pa.user_id IS NULL;
  SELECT o.id INTO STRICT foreign_org FROM public.organizations o
  JOIN public.organization_billing_access ba ON ba.organization_id=o.id
  WHERE o.slug='qa-finance-96-foreign-20261113'
    AND ba.is_test=true AND ba.requires_payment=false;
  IF (SELECT COUNT(*) FROM public.organization_members WHERE organization_id=test_org AND status='ACTIVE')<>1
     OR (SELECT COUNT(*) FROM public.member_roles WHERE organization_member_id=member_id)<>2 THEN
    RAISE EXCEPTION 'CLONE ONLY: TEST role fixture changed';
  END IF;
  PERFORM set_config('qa.org',test_org::text,true);
  PERFORM set_config('qa.foreign_org',foreign_org::text,true);
  PERFORM set_config('qa.member',member_id::text,true);
  PERFORM set_config('qa.actor',actor_id::text,true);
  PERFORM set_config('request.jwt.claim.sub',actor_id::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $fixture$;

-- Isolate ORGANIZATION_OWNER within the ongoing transaction.
DO $single_role$
DECLARE role_id uuid;
BEGIN
  SELECT id INTO STRICT role_id FROM public.roles
   WHERE organization_id=current_setting('qa.org')::uuid AND key='ORGANIZATION_OWNER' AND active;
  DELETE FROM public.member_roles WHERE organization_member_id=current_setting('qa.member')::uuid;
  INSERT INTO public.member_roles(organization_member_id,role_id)
   VALUES (current_setting('qa.member')::uuid,role_id);
  IF (SELECT COUNT(*) FROM public.member_roles WHERE organization_member_id=current_setting('qa.member')::uuid)<>1 THEN
    RAISE EXCEPTION 'TEST: more than one role assigned';
  END IF;
END $single_role$;

SET LOCAL ROLE authenticated;
DO $assert_role$
DECLARE tenant uuid:=current_setting('qa.org')::uuid;
 outsider uuid:=current_setting('qa.foreign_org')::uuid;
 issue_state text:='NONE';
 payout_state text:='NONE';
 review_state text:='NONE';
 receipt_state text:='NONE';
 cross_state text:='NONE';
BEGIN
 IF auth.uid() IS DISTINCT FROM current_setting('qa.actor')::uuid THEN
   RAISE EXCEPTION 'TEST: JWT role simulation missing';
 END IF;
 BEGIN
   PERFORM public.admin_issue_owner_statement('00000000-0000-4000-8000-000000000111'::uuid,tenant);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS issue_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_record_owner_payout('00000000-0000-4000-8000-000000000111'::uuid,
     tenant,1,current_date,'TRANSFER','QA-SIMULATED-001','QA-SIMULATED-001');
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS payout_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_decide_owner_payout_review(tenant,'00000000-0000-4000-8000-000000000111'::uuid,
     'RESOLVED','Autorizacion de prueba no persistente');
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS review_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.record_tenant_rent_receipt(tenant,'00000000-0000-4000-8000-000000000111'::uuid,
     1,'CASH','QA-REF','00000000-0000-4000-8000-000000000112'::uuid);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS receipt_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_issue_owner_statement('00000000-0000-4000-8000-000000000111'::uuid,outsider);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS cross_state=RETURNED_SQLSTATE;
 END;

 IF issue_state<>'P0002'
 OR payout_state<>'P0002'
 OR review_state<>'P0002'
 OR receipt_state<>'23514'
 OR cross_state<>'42501' THEN
   RAISE EXCEPTION 'SECURITY: ORGANIZATION_OWNER unexpected states: %, %, %, %, %',
     issue_state,payout_state,review_state,receipt_state,cross_state;
 END IF;
 RAISE NOTICE 'PASS ORGANIZATION_OWNER: issuer %, payout %, review %, rent %, cross-tenant %',
   issue_state,payout_state,review_state,receipt_state,cross_state;
END $assert_role$;
RESET ROLE;

-- Isolate ADMIN within the ongoing transaction.
DO $single_role$
DECLARE role_id uuid;
BEGIN
  SELECT id INTO STRICT role_id FROM public.roles
   WHERE organization_id=current_setting('qa.org')::uuid AND key='ADMIN' AND active;
  DELETE FROM public.member_roles WHERE organization_member_id=current_setting('qa.member')::uuid;
  INSERT INTO public.member_roles(organization_member_id,role_id)
   VALUES (current_setting('qa.member')::uuid,role_id);
  IF (SELECT COUNT(*) FROM public.member_roles WHERE organization_member_id=current_setting('qa.member')::uuid)<>1 THEN
    RAISE EXCEPTION 'TEST: more than one role assigned';
  END IF;
END $single_role$;

SET LOCAL ROLE authenticated;
DO $assert_role$
DECLARE tenant uuid:=current_setting('qa.org')::uuid;
 outsider uuid:=current_setting('qa.foreign_org')::uuid;
 issue_state text:='NONE';
 payout_state text:='NONE';
 review_state text:='NONE';
 receipt_state text:='NONE';
 cross_state text:='NONE';
BEGIN
 IF auth.uid() IS DISTINCT FROM current_setting('qa.actor')::uuid THEN
   RAISE EXCEPTION 'TEST: JWT role simulation missing';
 END IF;
 BEGIN
   PERFORM public.admin_issue_owner_statement('00000000-0000-4000-8000-000000000111'::uuid,tenant);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS issue_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_record_owner_payout('00000000-0000-4000-8000-000000000111'::uuid,
     tenant,1,current_date,'TRANSFER','QA-SIMULATED-001','QA-SIMULATED-001');
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS payout_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_decide_owner_payout_review(tenant,'00000000-0000-4000-8000-000000000111'::uuid,
     'RESOLVED','Autorizacion de prueba no persistente');
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS review_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.record_tenant_rent_receipt(tenant,'00000000-0000-4000-8000-000000000111'::uuid,
     1,'CASH','QA-REF','00000000-0000-4000-8000-000000000112'::uuid);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS receipt_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_issue_owner_statement('00000000-0000-4000-8000-000000000111'::uuid,outsider);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS cross_state=RETURNED_SQLSTATE;
 END;

 IF issue_state<>'P0002'
 OR payout_state<>'P0002'
 OR review_state<>'P0002'
 OR receipt_state<>'23514'
 OR cross_state<>'42501' THEN
   RAISE EXCEPTION 'SECURITY: ADMIN unexpected states: %, %, %, %, %',
     issue_state,payout_state,review_state,receipt_state,cross_state;
 END IF;
 RAISE NOTICE 'PASS ADMIN: issuer %, payout %, review %, rent %, cross-tenant %',
   issue_state,payout_state,review_state,receipt_state,cross_state;
END $assert_role$;
RESET ROLE;

-- Isolate MANAGER within the ongoing transaction.
DO $single_role$
DECLARE role_id uuid;
BEGIN
  SELECT id INTO STRICT role_id FROM public.roles
   WHERE organization_id=current_setting('qa.org')::uuid AND key='MANAGER' AND active;
  DELETE FROM public.member_roles WHERE organization_member_id=current_setting('qa.member')::uuid;
  INSERT INTO public.member_roles(organization_member_id,role_id)
   VALUES (current_setting('qa.member')::uuid,role_id);
  IF (SELECT COUNT(*) FROM public.member_roles WHERE organization_member_id=current_setting('qa.member')::uuid)<>1 THEN
    RAISE EXCEPTION 'TEST: more than one role assigned';
  END IF;
END $single_role$;

SET LOCAL ROLE authenticated;
DO $assert_role$
DECLARE tenant uuid:=current_setting('qa.org')::uuid;
 outsider uuid:=current_setting('qa.foreign_org')::uuid;
 issue_state text:='NONE';
 payout_state text:='NONE';
 review_state text:='NONE';
 receipt_state text:='NONE';
 cross_state text:='NONE';
BEGIN
 IF auth.uid() IS DISTINCT FROM current_setting('qa.actor')::uuid THEN
   RAISE EXCEPTION 'TEST: JWT role simulation missing';
 END IF;
 BEGIN
   PERFORM public.admin_issue_owner_statement('00000000-0000-4000-8000-000000000111'::uuid,tenant);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS issue_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_record_owner_payout('00000000-0000-4000-8000-000000000111'::uuid,
     tenant,1,current_date,'TRANSFER','QA-SIMULATED-001','QA-SIMULATED-001');
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS payout_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_decide_owner_payout_review(tenant,'00000000-0000-4000-8000-000000000111'::uuid,
     'RESOLVED','Autorizacion de prueba no persistente');
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS review_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.record_tenant_rent_receipt(tenant,'00000000-0000-4000-8000-000000000111'::uuid,
     1,'CASH','QA-REF','00000000-0000-4000-8000-000000000112'::uuid);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS receipt_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_issue_owner_statement('00000000-0000-4000-8000-000000000111'::uuid,outsider);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS cross_state=RETURNED_SQLSTATE;
 END;

 IF issue_state<>'42501'
 OR payout_state<>'42501'
 OR review_state<>'42501'
 OR receipt_state<>'42501'
 OR cross_state<>'42501' THEN
   RAISE EXCEPTION 'SECURITY: MANAGER unexpected states: %, %, %, %, %',
     issue_state,payout_state,review_state,receipt_state,cross_state;
 END IF;
 RAISE NOTICE 'PASS MANAGER: issuer %, payout %, review %, rent %, cross-tenant %',
   issue_state,payout_state,review_state,receipt_state,cross_state;
END $assert_role$;
RESET ROLE;

-- Isolate AGENT within the ongoing transaction.
DO $single_role$
DECLARE role_id uuid;
BEGIN
  SELECT id INTO STRICT role_id FROM public.roles
   WHERE organization_id=current_setting('qa.org')::uuid AND key='AGENT' AND active;
  DELETE FROM public.member_roles WHERE organization_member_id=current_setting('qa.member')::uuid;
  INSERT INTO public.member_roles(organization_member_id,role_id)
   VALUES (current_setting('qa.member')::uuid,role_id);
  IF (SELECT COUNT(*) FROM public.member_roles WHERE organization_member_id=current_setting('qa.member')::uuid)<>1 THEN
    RAISE EXCEPTION 'TEST: more than one role assigned';
  END IF;
END $single_role$;

SET LOCAL ROLE authenticated;
DO $assert_role$
DECLARE tenant uuid:=current_setting('qa.org')::uuid;
 outsider uuid:=current_setting('qa.foreign_org')::uuid;
 issue_state text:='NONE';
 payout_state text:='NONE';
 review_state text:='NONE';
 receipt_state text:='NONE';
 cross_state text:='NONE';
BEGIN
 IF auth.uid() IS DISTINCT FROM current_setting('qa.actor')::uuid THEN
   RAISE EXCEPTION 'TEST: JWT role simulation missing';
 END IF;
 BEGIN
   PERFORM public.admin_issue_owner_statement('00000000-0000-4000-8000-000000000111'::uuid,tenant);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS issue_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_record_owner_payout('00000000-0000-4000-8000-000000000111'::uuid,
     tenant,1,current_date,'TRANSFER','QA-SIMULATED-001','QA-SIMULATED-001');
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS payout_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_decide_owner_payout_review(tenant,'00000000-0000-4000-8000-000000000111'::uuid,
     'RESOLVED','Autorizacion de prueba no persistente');
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS review_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.record_tenant_rent_receipt(tenant,'00000000-0000-4000-8000-000000000111'::uuid,
     1,'CASH','QA-REF','00000000-0000-4000-8000-000000000112'::uuid);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS receipt_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_issue_owner_statement('00000000-0000-4000-8000-000000000111'::uuid,outsider);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS cross_state=RETURNED_SQLSTATE;
 END;

 IF issue_state<>'42501'
 OR payout_state<>'42501'
 OR review_state<>'42501'
 OR receipt_state<>'42501'
 OR cross_state<>'42501' THEN
   RAISE EXCEPTION 'SECURITY: AGENT unexpected states: %, %, %, %, %',
     issue_state,payout_state,review_state,receipt_state,cross_state;
 END IF;
 RAISE NOTICE 'PASS AGENT: issuer %, payout %, review %, rent %, cross-tenant %',
   issue_state,payout_state,review_state,receipt_state,cross_state;
END $assert_role$;
RESET ROLE;

-- Isolate CLIENT within the ongoing transaction.
DO $single_role$
DECLARE role_id uuid;
BEGIN
  SELECT id INTO STRICT role_id FROM public.roles
   WHERE organization_id=current_setting('qa.org')::uuid AND key='CLIENT' AND active;
  DELETE FROM public.member_roles WHERE organization_member_id=current_setting('qa.member')::uuid;
  INSERT INTO public.member_roles(organization_member_id,role_id)
   VALUES (current_setting('qa.member')::uuid,role_id);
  IF (SELECT COUNT(*) FROM public.member_roles WHERE organization_member_id=current_setting('qa.member')::uuid)<>1 THEN
    RAISE EXCEPTION 'TEST: more than one role assigned';
  END IF;
END $single_role$;

SET LOCAL ROLE authenticated;
DO $assert_role$
DECLARE tenant uuid:=current_setting('qa.org')::uuid;
 outsider uuid:=current_setting('qa.foreign_org')::uuid;
 issue_state text:='NONE';
 payout_state text:='NONE';
 review_state text:='NONE';
 receipt_state text:='NONE';
 cross_state text:='NONE';
BEGIN
 IF auth.uid() IS DISTINCT FROM current_setting('qa.actor')::uuid THEN
   RAISE EXCEPTION 'TEST: JWT role simulation missing';
 END IF;
 BEGIN
   PERFORM public.admin_issue_owner_statement('00000000-0000-4000-8000-000000000111'::uuid,tenant);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS issue_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_record_owner_payout('00000000-0000-4000-8000-000000000111'::uuid,
     tenant,1,current_date,'TRANSFER','QA-SIMULATED-001','QA-SIMULATED-001');
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS payout_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_decide_owner_payout_review(tenant,'00000000-0000-4000-8000-000000000111'::uuid,
     'RESOLVED','Autorizacion de prueba no persistente');
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS review_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.record_tenant_rent_receipt(tenant,'00000000-0000-4000-8000-000000000111'::uuid,
     1,'CASH','QA-REF','00000000-0000-4000-8000-000000000112'::uuid);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS receipt_state=RETURNED_SQLSTATE;
 END;
 BEGIN
   PERFORM public.admin_issue_owner_statement('00000000-0000-4000-8000-000000000111'::uuid,outsider);
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS cross_state=RETURNED_SQLSTATE;
 END;

 IF issue_state<>'42501'
 OR payout_state<>'42501'
 OR review_state<>'42501'
 OR receipt_state<>'42501'
 OR cross_state<>'42501' THEN
   RAISE EXCEPTION 'SECURITY: CLIENT unexpected states: %, %, %, %, %',
     issue_state,payout_state,review_state,receipt_state,cross_state;
 END IF;
 RAISE NOTICE 'PASS CLIENT: issuer %, payout %, review %, rent %, cross-tenant %',
   issue_state,payout_state,review_state,receipt_state,cross_state;
END $assert_role$;
RESET ROLE;

-- The statement above is deliberately the only durable-data exit point.
ROLLBACK;
SELECT 'PASS: 25 checks, five isolated role assignments, no persisted QA writes' AS result;
