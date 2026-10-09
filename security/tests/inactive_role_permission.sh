#!/usr/bin/env bash
# Disposable PostgreSQL only. Verify inactive roles cannot grant billing.manage.
set -euo pipefail
: "${DB_URL:?DB_URL must be a disposable PostgreSQL database}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/tests/atomic_order_fixture.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/experiments/inactive_role_permission_candidate.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM public.member_permissions;
INSERT INTO public.roles(id,organization_id,active)
VALUES ('77777777-7777-4777-8777-777777777777',NULL,true);
INSERT INTO public.member_roles(organization_member_id,role_id)
VALUES ('55555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777');
INSERT INTO public.role_permissions(role_id,permission_id)
VALUES ('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666');
BEGIN;
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
DO $$
BEGIN
 IF NOT public.has_org_permission('22222222-2222-4222-8222-222222222222','billing.manage') THEN
  RAISE EXCEPTION 'Active role should grant billing.manage';
 END IF;
END $$;
UPDATE public.roles SET active=false WHERE id='77777777-7777-4777-8777-777777777777';
DO $$
BEGIN
 IF public.has_org_permission('22222222-2222-4222-8222-222222222222','billing.manage') THEN
  RAISE EXCEPTION 'Inactive role incorrectly grants billing.manage';
 END IF;
END $$;
INSERT INTO public.member_permissions VALUES ('55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666','ALLOW');
DO $$
BEGIN
 IF NOT public.has_org_permission('22222222-2222-4222-8222-222222222222','billing.manage') THEN
  RAISE EXCEPTION 'Explicit ALLOW should remain effective';
 END IF;
END $$;
UPDATE public.member_permissions SET effect='DENY';
DO $$
BEGIN
 IF public.has_org_permission('22222222-2222-4222-8222-222222222222','billing.manage') THEN
  RAISE EXCEPTION 'Explicit DENY must prevail';
 END IF;
END $$;
ROLLBACK;
SQL
echo "PASS: active/inactive role behavior and explicit overrides"
