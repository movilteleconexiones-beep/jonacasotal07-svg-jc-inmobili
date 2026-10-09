-- Standalone disposable PostgreSQL cascade regression. Never execute on production.
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.test_orgs(id uuid PRIMARY KEY);
CREATE TABLE public.test_members(
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.test_orgs(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 UNIQUE(organization_id,user_id)
);
CREATE TABLE public.test_roles(id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES public.test_orgs(id) ON DELETE CASCADE);
CREATE TABLE public.test_member_roles(
 organization_member_id uuid REFERENCES public.test_members(id) ON DELETE CASCADE,
 role_id uuid REFERENCES public.test_roles(id) ON DELETE CASCADE,
 PRIMARY KEY(organization_member_id,role_id)
);
INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001');
INSERT INTO public.test_orgs VALUES ('00000000-0000-4000-8000-000000000002');
INSERT INTO public.test_members VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
INSERT INTO public.test_roles VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002');
INSERT INTO public.test_member_roles VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004');
DELETE FROM auth.users WHERE id='00000000-0000-4000-8000-000000000001';
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.test_members) THEN RAISE EXCEPTION 'Orphan membership'; END IF;
 IF EXISTS(SELECT 1 FROM public.test_member_roles) THEN RAISE EXCEPTION 'Orphan role assignment'; END IF;
 IF (SELECT count(*) FROM public.test_orgs)<>1 THEN RAISE EXCEPTION 'Unexpected organization deletion'; END IF;
END $$;
SELECT 'PASS: synthetic user deletion cascades to membership and role assignment' AS result;
