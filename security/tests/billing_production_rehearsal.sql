-- Run ONLY inside the caller's transaction after loading the two migrations.
-- The caller MUST ROLLBACK. No test users, payments or acceptances are retained.
DO $rehearsal$
DECLARE test_user uuid:=gen_random_uuid(); test_org uuid; admin_user uuid; terms_id uuid;
  plan_id uuid; order_data jsonb; receipt text; result text; test_email text;
BEGIN
  test_email:='billing-rehearsal-'||replace(test_user::text,'-','')||'@example.invalid';
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(test_user,test_email,'{}');
  PERFORM set_config('request.jwt.claim.sub',test_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',test_user,'role','authenticated')::text,true);
  test_org:=public.create_organization_with_owner('INMOJCO billing rehearsal','qa-billing-'||replace(test_user::text,'-',''),'CO');
  IF (SELECT status FROM public.organizations WHERE id=test_org)<>'TRIAL'
    OR public.has_org_permission(test_org,'properties.view') THEN RAISE EXCEPTION 'Unpaid onboarding access'; END IF;
  SELECT user_id INTO admin_user FROM public.platform_admins WHERE active AND admin_level IN ('SUPER_ADMIN','PLATFORM_OWNER') LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub',admin_user::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_user,'role','authenticated')::text,true);
  PERFORM public.billing_admin_action(test_org,'MARK_TEST','Rehearsal rolled back; isolated synthetic tenant');
  UPDATE public.billing_activation_settings SET sandbox_enabled=true;
  PERFORM set_config('request.jwt.claim.sub',test_user::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',test_user,'role','authenticated')::text,true);
  SELECT id INTO terms_id FROM public.license_terms_versions WHERE active ORDER BY effective_date DESC,created_at DESC LIMIT 1;
  PERFORM public.billing_accept_terms(test_org,terms_id,'transactional rehearsal');
  SELECT id INTO plan_id FROM public.plans WHERE code='BASIC';
  order_data:=public.billing_create_order(test_org,plan_id,'sandbox',gen_random_uuid());
  receipt:=order_data->>'reference';
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',test_user,'role','service_role')::text,true);
  result:=public.process_verified_payment_event(receipt,'qa-'||test_user::text,(order_data->>'amount_in_cents')::bigint,
    'COP','APPROVED','sandbox',repeat('a',64),repeat('b',64));
  IF result<>'processed' THEN RAISE EXCEPTION 'Rehearsal payment: %',result; END IF;
  result:=public.process_verified_payment_event(receipt,'qa-'||test_user::text,(order_data->>'amount_in_cents')::bigint,
    'COP','APPROVED','sandbox',repeat('a',64),repeat('c',64));
  IF result<>'duplicate' THEN RAISE EXCEPTION 'Rehearsal duplicate: %',result; END IF;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',test_user,'role','authenticated')::text,true);
  IF NOT public.has_org_permission(test_org,'properties.view') OR public.has_org_permission(test_org,'reports.view')
    OR NOT jco_private.operational_access(test_org) THEN RAISE EXCEPTION 'Plan entitlements mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organization_licenses WHERE organization_id=test_org AND status='ACTIVE')
    OR NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE organization_id=test_org AND status='ACTIVE')
    THEN RAISE EXCEPTION 'Partial license/subscription'; END IF;
  PERFORM set_config('request.jwt.claim.sub',admin_user::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_user,'role','authenticated')::text,true);
  PERFORM public.billing_admin_action(test_org,'SUSPEND','Synthetic suspension test; rolled back');
  IF jco_private.operational_access(test_org) THEN RAISE EXCEPTION 'Suspension failed'; END IF;
END $rehearsal$;
