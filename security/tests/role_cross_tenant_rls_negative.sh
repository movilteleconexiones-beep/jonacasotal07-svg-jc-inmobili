#!/usr/bin/env bash
# RLS reproduction in a disposable PostgreSQL database. No production access.
set -euo pipefail
: "${DB_URL:?DB_URL must point to a disposable PostgreSQL database}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/tests/atomic_order_fixture.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE public.roles (
 id uuid PRIMARY KEY,
 organization_id uuid REFERENCES public.organizations(id),
 active boolean NOT NULL DEFAULT true
);
INSERT INTO public.roles VALUES
 ('77777777-7777-4777-8777-777777777777','33333333-3333-4333-8333-333333333333',true);
ALTER TABLE public.member_roles
 ADD CONSTRAINT member_roles_member_fk FOREIGN KEY(organization_member_id) REFERENCES public.organization_members(id) ON DELETE CASCADE;
ALTER TABLE public.member_roles
 ADD CONSTRAINT member_roles_role_fk FOREIGN KEY(role_id) REFERENCES public.roles(id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION public.has_org_permission(target_org uuid,permission_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT target_org='22222222-2222-4222-8222-222222222222'::uuid
 AND permission_key='roles.assign'
 AND auth.uid()='44444444-4444-4444-8444-444444444444'::uuid
$$;
ALTER TABLE public.member_roles ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON public.organization_members TO authenticated;
GRANT INSERT,SELECT ON public.member_roles TO authenticated;
CREATE POLICY member_roles_manage_admin ON public.member_roles
 FOR ALL TO authenticated
 USING (EXISTS(SELECT 1 FROM public.organization_members m
   WHERE m.id=member_roles.organization_member_id
     AND public.has_org_permission(m.organization_id,'roles.assign')))
 WITH CHECK (EXISTS(SELECT 1 FROM public.organization_members m
   WHERE m.id=member_roles.organization_member_id
     AND public.has_org_permission(m.organization_id,'roles.assign')));
-- The fixture's original policy accepts a foreign-tenant role; this is an
-- EXPECTED vulnerability reproduction, not a successful security outcome.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
INSERT INTO public.member_roles VALUES
 ('55555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777');
RESET ROLE;
DO $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.member_roles
  WHERE organization_member_id='55555555-5555-4555-8555-555555555555'
  AND role_id='77777777-7777-4777-8777-777777777777'
 ) THEN RAISE EXCEPTION 'Fixture did not reproduce original policy vulnerability'; END IF;
END $$;
SQL
echo "PASS: expected cross-tenant assignment reproduced under original RLS policy"
