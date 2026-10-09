#!/usr/bin/env bash
set -euo pipefail
# Run only in disposable PostgreSQL. DB_URL must point to an isolated test DB.
: "${DB_URL:?Set DB_URL to an isolated PostgreSQL test database}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/tests/atomic_order_fixture.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0032_atomic_sandbox_payment_order_draft.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0033_billing_revocation_lock_prototype_draft.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/tests/billing_lock_smoke.sql

# Session A holds lock; session B must fail with a short lock timeout.
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; SELECT public.lock_tenant_billing_authorization('22222222-2222-4222-8222-222222222222'); SELECT pg_sleep(3); COMMIT;" >/dev/null &
holder=$!
trap 'kill "$holder" 2>/dev/null || true' EXIT
sleep 1
if psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; SET LOCAL lock_timeout='500ms'; SELECT public.lock_tenant_billing_authorization('22222222-2222-4222-8222-222222222222'); COMMIT;" > /tmp/jco_billing_lock_wait.log 2>&1; then
 echo "SECURITY: concurrent session bypassed tenant lock" >&2
 exit 1
fi
if ! grep -q 'lock timeout' /tmp/jco_billing_lock_wait.log; then
 cat /tmp/jco_billing_lock_wait.log >&2
 echo "SECURITY: expected lock timeout, got another error" >&2
 exit 1
fi
wait "$holder"
trap - EXIT
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; SET LOCAL lock_timeout='500ms'; SELECT public.lock_tenant_billing_authorization('22222222-2222-4222-8222-222222222222'); COMMIT;" >/dev/null
echo "PASS: concurrent billing lock waits, then releases on commit"

# Revocation must acquire the lock automatically through its database trigger; no explicit lock call.
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; UPDATE public.member_permissions SET effect='DENY'; SELECT pg_sleep(3); COMMIT;" >/dev/null &
revoker=$!
trap 'kill "$revoker" 2>/dev/null || true' EXIT
sleep 1
if psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; SET LOCAL lock_timeout='500ms'; SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true); SELECT set_config('request.jwt.claim.role','authenticated',true); SELECT public.create_authorized_sandbox_payment_order('22222222-2222-4222-8222-222222222222','BASIC','JCO_'||repeat('a',32)); COMMIT;" > /tmp/jco_order_revocation_wait.log 2>&1; then
 echo "SECURITY: order bypassed revocation transaction" >&2; exit 1
fi
if ! grep -q 'lock timeout' /tmp/jco_order_revocation_wait.log; then
 cat /tmp/jco_order_revocation_wait.log >&2; exit 1
fi
wait "$revoker"
trap - EXIT
if psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true); SELECT set_config('request.jwt.claim.role','authenticated',true); SELECT public.create_authorized_sandbox_payment_order('22222222-2222-4222-8222-222222222222','BASIC','JCO_'||repeat('b',32)); COMMIT;" >/tmp/jco_denied_after_revocation.log 2>&1; then
 echo "SECURITY: order succeeded after billing DENY committed" >&2; exit 1
fi
if ! grep -q 'Billing permission denied' /tmp/jco_denied_after_revocation.log; then
 cat /tmp/jco_denied_after_revocation.log >&2; exit 1
fi
echo "PASS: order blocked during revocation and denied after commit"
