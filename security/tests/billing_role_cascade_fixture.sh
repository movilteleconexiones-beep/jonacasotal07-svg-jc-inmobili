#!/usr/bin/env bash
# Disposable PostgreSQL ONLY. Recreate real role foreign keys and CASCADE behavior.
set -euo pipefail
: "${DB_URL:?DB_URL must point to an isolated disposable PostgreSQL database}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/tests/atomic_order_fixture.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0032_atomic_sandbox_payment_order_draft.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0033_billing_revocation_lock_prototype_draft.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/experiments/role_permission_lock_candidate.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE public.roles(id uuid PRIMARY KEY, organization_id uuid NULL REFERENCES public.organizations(id), active boolean NOT NULL DEFAULT true);
ALTER TABLE public.member_roles
 ADD CONSTRAINT member_roles_membership_fk FOREIGN KEY (organization_member_id)
 REFERENCES public.organization_members(id) ON DELETE CASCADE,
 ADD CONSTRAINT member_roles_role_fk FOREIGN KEY (role_id)
 REFERENCES public.roles(id) ON DELETE CASCADE;
ALTER TABLE public.role_permissions
 ADD CONSTRAINT role_permissions_role_fk FOREIGN KEY (role_id)
 REFERENCES public.roles(id) ON DELETE CASCADE,
 ADD CONSTRAINT role_permissions_permission_fk FOREIGN KEY (permission_id)
 REFERENCES public.permissions(id) ON DELETE CASCADE;
INSERT INTO public.roles(id,organization_id) VALUES
 ('77777777-7777-4777-8777-777777777777',NULL);
INSERT INTO public.organization_members(id,organization_id,user_id,status) VALUES
 ('88888888-8888-4888-8888-888888888888','33333333-3333-4333-8333-333333333333','99999999-9999-4999-8999-999999999999','ACTIVE');
INSERT INTO public.member_roles VALUES
 ('55555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777'),
 ('88888888-8888-4888-8888-888888888888','77777777-7777-4777-8777-777777777777');
INSERT INTO public.role_permissions VALUES
 ('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666');
BEGIN;
DELETE FROM public.roles WHERE id='77777777-7777-4777-8777-777777777777';
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_locks
 WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted;
 IF n < 2 THEN
  RAISE EXCEPTION 'Cascade role deletion acquired % advisory locks; expected at least 2',n;
 END IF;
 IF EXISTS(SELECT 1 FROM public.role_permissions WHERE role_id='77777777-7777-4777-8777-777777777777') THEN
  RAISE EXCEPTION 'Role permission cascade did not remove grants';
 END IF;
 RAISE NOTICE 'PASS: role deletion cascade acquired locks for both organizations';
END $$;
ROLLBACK;
SQL
