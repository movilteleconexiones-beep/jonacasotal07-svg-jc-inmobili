-- G14 clone-only acceptance, execute INSIDE same transaction as SQL install.
-- Never run fixture against production; all membership updates are rolled back.
DO $qa$
DECLARE
 v_qa_org uuid;
 v_foreign_org uuid;
 v_member uuid;
 v_actor uuid;
 v_valid_role uuid;
 v_existing_role uuid;
 v_foreign_role uuid;
 v_pass integer:=0;
 v_message text;
 v_count integer;
BEGIN
 SELECT id INTO STRICT v_qa_org FROM public.organizations
 WHERE slug='sistema-inmobiliario-jco';
 SELECT id INTO STRICT v_foreign_org FROM public.organizations
 WHERE slug='jco-inmodigital-global';
 SELECT id,user_id INTO STRICT v_member,v_actor FROM public.organization_members
 WHERE organization_id=v_qa_org AND status='ACTIVE';
 IF EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=v_actor AND active)
 THEN RAISE EXCEPTION 'QA actor is privileged: abort'; END IF;
 SELECT id INTO STRICT v_valid_role FROM public.roles
 WHERE organization_id=v_qa_org AND key='ADMIN' AND active;
 SELECT r.id INTO STRICT v_existing_role FROM public.member_roles mr
 JOIN public.roles r ON r.id=mr.role_id
 WHERE mr.organization_member_id=v_member AND r.key='CLIENT'
   AND r.organization_id=v_qa_org;
 SELECT id INTO STRICT v_foreign_role FROM public.roles
 WHERE organization_id=v_foreign_org AND key='ADMIN' AND active;
 IF EXISTS(SELECT 1 FROM public.member_roles WHERE organization_member_id=v_member
   AND role_id IN(v_valid_role,v_foreign_role)) THEN
   RAISE EXCEPTION 'QA target assignments were not free';
 END IF;

 PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF NOT public.has_org_permission(v_qa_org,'roles.assign') THEN
   RAISE EXCEPTION 'QA owner has no role-assign permission';
 END IF;

 -- 1: legitimate tenant-local grant succeeds under authenticated RLS.
 INSERT INTO public.member_roles(organization_member_id,role_id)
 VALUES(v_member,v_valid_role);
 SELECT count(*) INTO v_count FROM public.member_roles
 WHERE organization_member_id=v_member AND role_id=v_valid_role;
 IF v_count<>1 THEN RAISE EXCEPTION 'Tenant-local grant not persisted within QA txn'; END IF;
 v_pass:=v_pass+1;

 -- 2: legitimate removal also works with existing G13 guards.
 DELETE FROM public.member_roles
 WHERE organization_member_id=v_member AND role_id=v_valid_role;
 IF FOUND THEN v_pass:=v_pass+1;
 ELSE RAISE EXCEPTION 'Tenant-local role removal failed'; END IF;

 -- 3: foreign tenant role INSERT is not allowed.
 BEGIN
  INSERT INTO public.member_roles(organization_member_id,role_id)
  VALUES(v_member,v_foreign_role);
  RAISE EXCEPTION 'FAIL: cross-tenant INSERT was allowed';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
  IF v_message<>'El rol debe pertenecer a la misma inmobiliaria' THEN
    RAISE EXCEPTION 'Unexpected cross-tenant INSERT refusal: %',v_message;
  END IF;
  v_pass:=v_pass+1;
 END;

 -- 4: existing role cannot be swapped for foreign tenant role.
 BEGIN
  UPDATE public.member_roles SET role_id=v_foreign_role
  WHERE organization_member_id=v_member AND role_id=v_existing_role;
  RAISE EXCEPTION 'FAIL: cross-tenant UPDATE was allowed';
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
  IF v_message<>'El rol debe pertenecer a la misma inmobiliaria' THEN
    RAISE EXCEPTION 'Unexpected cross-tenant UPDATE refusal: %',v_message;
  END IF;
  v_pass:=v_pass+1;
 END;
 EXECUTE 'RESET ROLE';

 -- 5: original assignment remains intact; zero foreign links.
 IF (SELECT count(*) FROM public.member_roles mr
   JOIN public.organization_members m ON m.id=mr.organization_member_id
   JOIN public.roles r ON r.id=mr.role_id
   WHERE r.organization_id IS DISTINCT FROM m.organization_id)<>0 THEN
   RAISE EXCEPTION 'Cross-tenant assignment persisted in transaction';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.member_roles WHERE organization_member_id=v_member
   AND role_id=v_existing_role)
 OR EXISTS(SELECT 1 FROM public.member_roles WHERE organization_member_id=v_member
   AND role_id IN(v_valid_role,v_foreign_role)) THEN
   RAISE EXCEPTION 'QA altered permanent role assignments';
 END IF;
 v_pass:=v_pass+1;

 IF v_pass<>5 THEN RAISE EXCEPTION 'G14 expected 5 checks, got %',v_pass; END IF;
 RAISE NOTICE 'G14_CLONE_AUDIT 5/5 PASS, no membership data persisted';
END $qa$;
