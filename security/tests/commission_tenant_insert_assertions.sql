-- Isolated SQL regression after commission correction fixture and migrations.
SELECT set_config('jco_test.actor','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
SET ROLE authenticated;
DO $verify$
DECLARE refused boolean;
BEGIN
 -- Mismatched org and deal must never be linked.
 refused:=false;
 BEGIN
  INSERT INTO public.commissions(
    organization_id,deal_id,beneficiary_user_id,commission_type,percentage,
    calculation_basis,amount,currency,status,created_by
  ) VALUES(
    '11111111-1111-4111-8111-111111111111',
    '22222222-3333-4444-8555-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','AGENT',10,1800000,180000,'COP','PENDING',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 EXCEPTION WHEN check_violation THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'Cross-company commission insert allowed'; END IF;
 -- Beneficiary from another agency must be rejected independently.
 refused:=false;
 BEGIN
  INSERT INTO public.commissions(
    organization_id,deal_id,beneficiary_user_id,commission_type,percentage,
    calculation_basis,amount,currency,status,created_by
  ) VALUES(
    '11111111-1111-4111-8111-111111111111',
    '11111111-2222-4333-8444-111111111111',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc','AGENT',10,1800000,180000,'COP','PENDING',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 EXCEPTION WHEN check_violation THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'Foreign tenant beneficiary insert allowed'; END IF;
 -- A NULL percentage cannot skip the exact commission calculation.
 refused:=false;
 BEGIN
  INSERT INTO public.commissions(
    organization_id,deal_id,beneficiary_user_id,commission_type,percentage,
    calculation_basis,amount,currency,status,created_by
  ) VALUES(
    '11111111-1111-4111-8111-111111111111',
    '11111111-2222-4333-8444-111111111111',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','AGENT',NULL,1800000,180000,'COP','PENDING',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 EXCEPTION WHEN check_violation THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'NULL percentage escaped validation'; END IF;
 -- Normal tenant-scoped form submission remains functional.
 INSERT INTO public.commissions(
    organization_id,deal_id,beneficiary_user_id,commission_type,percentage,
    calculation_basis,amount,currency,status,created_by
  ) VALUES(
    '11111111-1111-4111-8111-111111111111',
    '11111111-2222-4333-8444-111111111111',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','AGENT',10,1800000,180000,'COP','PENDING',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
END $verify$;
RESET ROLE;
DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.commissions)<>5 THEN RAISE EXCEPTION 'Unexpected commission writes'; END IF;
 IF (SELECT count(*) FROM public.commissions WHERE status='PAID' AND amount=1800000)<>1 THEN
   RAISE EXCEPTION 'Historical paid commission was overwritten'; END IF;
END $verify$;
SELECT 'PASS agency isolation of commission inserts and normal create' result;
