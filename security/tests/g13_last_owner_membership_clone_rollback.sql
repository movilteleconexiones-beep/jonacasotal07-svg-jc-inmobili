-- G13 exact negative SQL acceptance for RESTORED clone only.
-- Use in SAME transaction after g13_protect_last_owner_system_roles.sql
-- with its final COMMIT removed, then ROLLBACK. Never use live agency as a fixture.
DO $qa$
DECLARE
 v_qa_org uuid;
 v_main_org uuid;
 v_qa_member uuid;
 v_main_member uuid;
 v_qa_owner_role uuid;
 v_qa_admin_role uuid;
 v_main_owner_role uuid;
 v_pass integer:=0;
 v_updates integer;
BEGIN
 SELECT id INTO STRICT v_qa_org FROM public.organizations WHERE slug='sistema-inmobiliario-jco';
 SELECT id INTO STRICT v_main_org FROM public.organizations WHERE slug='jco-inmodigital-global';
 SELECT m.id INTO STRICT v_qa_member FROM public.organization_members m
 WHERE m.organization_id=v_qa_org AND m.status='ACTIVE';
 SELECT m.id INTO STRICT v_main_member FROM public.organization_members m
 WHERE m.organization_id=v_main_org AND m.status='ACTIVE';
 SELECT id INTO STRICT v_qa_owner_role FROM public.roles WHERE organization_id=v_qa_org AND key='ORGANIZATION_OWNER';
 SELECT id INTO STRICT v_qa_admin_role FROM public.roles WHERE organization_id=v_qa_org AND key='ADMIN';
 SELECT id INTO STRICT v_main_owner_role FROM public.roles WHERE organization_id=v_main_org AND key='ORGANIZATION_OWNER';
 IF v_main_member=v_qa_member OR NOT EXISTS(
  SELECT 1 FROM public.member_roles WHERE organization_member_id=v_qa_member AND role_id=v_qa_owner_role
 ) OR NOT EXISTS (
  SELECT 1 FROM public.member_roles WHERE organization_member_id=v_main_member AND role_id=v_main_owner_role
 ) OR NOT EXISTS (
  SELECT 1 FROM public.platform_admins pa
   JOIN public.organization_members m ON m.user_id=pa.user_id
   WHERE m.id=v_main_member AND pa.active
 ) THEN RAISE EXCEPTION 'Unsafe G13 QA fixture'; END IF;

 BEGIN
  UPDATE public.organization_members SET status='SUSPENDED' WHERE id=v_qa_member;
  RAISE EXCEPTION 'FAIL: last active owner suspension allowed';
 EXCEPTION WHEN insufficient_privilege THEN v_pass:=v_pass+1; END;

 BEGIN
  UPDATE public.organization_members SET user_id=gen_random_uuid() WHERE id=v_qa_member;
  RAISE EXCEPTION 'FAIL: membership identity reassignment allowed';
 EXCEPTION WHEN insufficient_privilege THEN v_pass:=v_pass+1; END;

 BEGIN
  DELETE FROM public.member_roles WHERE organization_member_id=v_qa_member AND role_id=v_qa_owner_role;
  RAISE EXCEPTION 'FAIL: last owner role deletion allowed';
 EXCEPTION WHEN insufficient_privilege THEN v_pass:=v_pass+1; END;

 BEGIN
  UPDATE public.member_roles SET role_id=v_qa_admin_role
   WHERE organization_member_id=v_qa_member AND role_id=v_qa_owner_role;
  RAISE EXCEPTION 'FAIL: last owner role demotion allowed';
 EXCEPTION WHEN insufficient_privilege THEN v_pass:=v_pass+1; END;

 BEGIN
  UPDATE public.organization_members SET status='SUSPENDED' WHERE id=v_main_member;
  RAISE EXCEPTION 'FAIL: SuperAdmin member suspension allowed';
 EXCEPTION WHEN insufficient_privilege THEN v_pass:=v_pass+1; END;

 BEGIN
  DELETE FROM public.member_roles WHERE organization_member_id=v_main_member AND role_id=v_main_owner_role;
  RAISE EXCEPTION 'FAIL: SuperAdmin role deletion allowed';
 EXCEPTION WHEN insufficient_privilege THEN v_pass:=v_pass+1; END;

 BEGIN
  DELETE FROM public.roles WHERE id=v_qa_owner_role;
  RAISE EXCEPTION 'FAIL: system role deletion allowed';
 EXCEPTION WHEN insufficient_privilege THEN v_pass:=v_pass+1; END;

 -- Harmless member update must still work; no global lockout regression.
 UPDATE public.organization_members SET status=status WHERE id=v_qa_member;
 GET DIAGNOSTICS v_updates=ROW_COUNT;
 IF v_updates<>1 THEN RAISE EXCEPTION 'FAIL: harmless member update blocked'; END IF;
 v_pass:=v_pass+1;

 IF v_pass<>8
 OR (SELECT status FROM public.organization_members WHERE id=v_qa_member)<>'ACTIVE'
 OR (SELECT status FROM public.organization_members WHERE id=v_main_member)<>'ACTIVE'
 OR NOT EXISTS(SELECT 1 FROM public.member_roles WHERE organization_member_id=v_qa_member AND role_id=v_qa_owner_role)
 OR NOT EXISTS(SELECT 1 FROM public.member_roles WHERE organization_member_id=v_main_member AND role_id=v_main_owner_role)
 THEN RAISE EXCEPTION 'G13 fixture incorrect: % of 8',v_pass; END IF;
 RAISE NOTICE 'G13_NEGATIVE_QA 8/8 PASS; everything will ROLLBACK';
END $qa$;
