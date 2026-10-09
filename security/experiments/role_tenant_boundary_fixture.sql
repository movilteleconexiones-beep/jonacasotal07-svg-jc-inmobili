-- Disposable PostgreSQL fixture only. Do not deploy.
-- Demonstrates the missing cross-tenant role assignment predicate.
BEGIN;
CREATE TABLE IF NOT EXISTS public.roles (
 id uuid PRIMARY KEY,
 organization_id uuid REFERENCES public.organizations(id),
 active boolean NOT NULL DEFAULT true
);
INSERT INTO public.roles(id,organization_id,active) VALUES
 ('77777777-7777-4777-8777-777777777777','33333333-3333-4333-8333-333333333333',true);
ALTER TABLE public.member_roles
 ADD CONSTRAINT member_roles_member_fk FOREIGN KEY(organization_member_id)
 REFERENCES public.organization_members(id) ON DELETE CASCADE;
ALTER TABLE public.member_roles
 ADD CONSTRAINT member_roles_role_fk FOREIGN KEY(role_id)
 REFERENCES public.roles(id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION public.role_matches_member_tenant(member_id uuid, assigned_role_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.organization_members m
   JOIN public.roles r ON r.id=assigned_role_id
   WHERE m.id=member_id
     AND (r.organization_id IS NULL OR r.organization_id=m.organization_id)
 )
$$;
-- Cross-tenant role should not match.
DO $$
BEGIN
 IF public.role_matches_member_tenant(
  '55555555-5555-4555-8555-555555555555',
  '77777777-7777-4777-8777-777777777777'
 ) THEN RAISE EXCEPTION 'Cross-tenant role was accepted'; END IF;
END $$;
ROLLBACK;
