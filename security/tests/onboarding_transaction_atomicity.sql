-- Isolated transaction atomicity fixture; not the production onboarding RPC.
CREATE TABLE public.onboarding_test_orgs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 slug text NOT NULL UNIQUE
);
CREATE TABLE public.onboarding_test_members (
 org_id bigint NOT NULL REFERENCES public.onboarding_test_orgs(id),
 user_id uuid NOT NULL,
 role_key text NOT NULL CHECK(role_key='ORGANIZATION_OWNER'),
 PRIMARY KEY(org_id,user_id)
);
CREATE OR REPLACE FUNCTION public.onboarding_test_create(
 target_slug text, target_user uuid, fail_after_org boolean DEFAULT false
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE new_org bigint;
BEGIN
 IF target_user IS NULL OR target_slug IS NULL OR length(trim(target_slug)) < 3
 THEN RAISE EXCEPTION 'Invalid onboarding input'; END IF;
 INSERT INTO public.onboarding_test_orgs(slug) VALUES (target_slug) RETURNING id INTO new_org;
 IF fail_after_org THEN RAISE EXCEPTION 'Injected failure after organization insert'; END IF;
 INSERT INTO public.onboarding_test_members(org_id,user_id,role_key)
 VALUES(new_org,target_user,'ORGANIZATION_OWNER');
 RETURN new_org;
END $$;
-- Success creates exactly one owner.
SELECT public.onboarding_test_create('tenant-alpha','44444444-4444-4444-8444-444444444444');
DO $$
BEGIN
 IF (SELECT count(*) FROM public.onboarding_test_orgs)<>1 OR
    (SELECT count(*) FROM public.onboarding_test_members WHERE role_key='ORGANIZATION_OWNER')<>1
 THEN RAISE EXCEPTION 'FAIL: owner transaction'; END IF;
END $$;
-- Errors are caught in nested PL/pgSQL subtransactions, so partial inserts roll back.
DO $$
BEGIN
 BEGIN
  PERFORM public.onboarding_test_create('tenant-beta','44444444-4444-4444-8444-444444444444',true);
  RAISE EXCEPTION 'FAIL: injected failure unexpectedly succeeded';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Injected failure after organization insert' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.onboarding_test_orgs WHERE slug='tenant-beta')
 THEN RAISE EXCEPTION 'FAIL: orphan organization after rollback'; END IF;
END $$;
DO $$
BEGIN
 BEGIN
  PERFORM public.onboarding_test_create('tenant-alpha','44444444-4444-4444-8444-444444444444');
  RAISE EXCEPTION 'FAIL: duplicate slug unexpectedly succeeded';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 IF (SELECT count(*) FROM public.onboarding_test_orgs)<>1 OR
    (SELECT count(*) FROM public.onboarding_test_members)<>1
 THEN RAISE EXCEPTION 'FAIL: duplicate slug caused partial writes'; END IF;
END $$;
SELECT 'PASS: isolated owner creation, injected rollback and duplicate slug' AS result;
