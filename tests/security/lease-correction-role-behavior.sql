\set ON_ERROR_STOP on
-- Isolated behavior test. Models the admin gate; not production RPC bodies.
CREATE TABLE public.test_members(org uuid,actor uuid,role text,active boolean);
CREATE FUNCTION public.test_can_correct(p_org uuid,p_actor uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM public.test_members WHERE org=p_org AND actor=p_actor AND active AND role IN ('ADMIN','ORGANIZATION_ADMIN'));
$$;
DO $t$
DECLARE org uuid:='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
 org2 uuid:='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
 admin uuid:='11111111-1111-4111-8111-111111111111';
 advisor uuid:='22222222-2222-4222-8222-222222222222';
 coordinator uuid:='33333333-3333-4333-8333-333333333333';
 other_admin uuid:='44444444-4444-4444-8444-444444444444';
BEGIN
 INSERT INTO public.test_members VALUES
 (org,admin,'ADMIN',true),(org,advisor,'ADVISOR',true),
 (org,coordinator,'COORDINATOR',true),(org2,other_admin,'ADMIN',true);
 IF NOT public.test_can_correct(org,admin) THEN RAISE EXCEPTION 'Admin blocked'; END IF;
 IF public.test_can_correct(org,advisor) THEN RAISE EXCEPTION 'Advisor permitted'; END IF;
 IF public.test_can_correct(org,coordinator) THEN RAISE EXCEPTION 'Coordinator permitted'; END IF;
 IF public.test_can_correct(org,other_admin) THEN RAISE EXCEPTION 'Other tenant admin permitted'; END IF;
 UPDATE public.test_members SET active=false WHERE actor=admin;
 IF public.test_can_correct(org,admin) THEN RAISE EXCEPTION 'Inactive admin permitted'; END IF;
END $t$;
SELECT 'isolated tenant role gate behavior passed';
