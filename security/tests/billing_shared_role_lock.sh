#!/usr/bin/env bash
# Disposable PostgreSQL only: verify shared role changes lock every affected tenant.
set -euo pipefail
: "${DB_URL:?Set DB_URL to a disposable PostgreSQL database}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/tests/atomic_order_fixture.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0032_atomic_sandbox_payment_order_draft.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0033_billing_revocation_lock_prototype_draft.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/experiments/role_permission_lock_candidate.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.organization_members(id,organization_id,user_id,status)
VALUES ('88888888-8888-4888-8888-888888888888',
        '33333333-3333-4333-8333-333333333333',
        '99999999-9999-4999-8999-999999999999','ACTIVE');
INSERT INTO public.member_roles(organization_member_id,role_id)
VALUES ('55555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777'),
       ('88888888-8888-4888-8888-888888888888','77777777-7777-4777-8777-777777777777');
BEGIN;
INSERT INTO public.role_permissions(role_id,permission_id)
VALUES ('77777777-7777-4777-8777-777777777777',
        '66666666-6666-4666-8666-666666666666');
DO $$
DECLARE lock_count integer;
BEGIN
 SELECT count(*) INTO lock_count
 FROM pg_locks
 WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted;
 IF lock_count <> 2 THEN
  RAISE EXCEPTION 'Expected two tenant advisory locks for shared role; observed %', lock_count;
 END IF;
 RAISE NOTICE 'PASS: shared role grant locks both tenants';
END $$;
ROLLBACK;
SQL
