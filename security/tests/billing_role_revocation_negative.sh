#!/usr/bin/env bash
# NEGATIVE SECURITY REGRESSION TEST. Expected to FAIL on migration 0033.
# Run ONLY on a disposable PostgreSQL database with no valuable data.
set -euo pipefail
: "${DB_URL:?DB_URL must point to an isolated disposable PostgreSQL database}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/tests/atomic_order_fixture.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0032_atomic_sandbox_payment_order_draft.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0033_billing_revocation_lock_prototype_draft.sql

# Eliminate direct override so authorization is exclusively role-derived.
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM public.member_permissions;
INSERT INTO public.member_roles(organization_member_id,role_id)
VALUES ('55555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777');
INSERT INTO public.role_permissions(role_id,permission_id)
VALUES ('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666');
SQL

tmpdir=$(mktemp -d)
holder=""
cleanup() { if [[ -n "$holder" ]]; then kill "$holder" 2>/dev/null || true; wait "$holder" 2>/dev/null || true; fi; rm -rf "$tmpdir"; }
trap cleanup EXIT

# A: hold the tenant advisory lock through an authorized order.
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true); SELECT set_config('request.jwt.claim.role','authenticated',true); SELECT public.create_authorized_sandbox_payment_order('22222222-2222-4222-8222-222222222222','BASIC','JCO_'||repeat('d',32)); SELECT pg_sleep(5); COMMIT;" >"$tmpdir/order.log" 2>&1 &
holder=$!
# Poll for a committed-or-in-progress order instead of relying on a fixed sleep.
ready=0
for _ in {1..30}; do
  if psql "$DB_URL" -At -c "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE query LIKE '%pg_sleep(5)%' AND state='active' AND pid<>pg_backend_pid())" | grep -qx t; then ready=1; break; fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then echo "Could not observe active order transaction" >&2; cat "$tmpdir/order.log" >&2; exit 2; fi

# B: revoking role grant must wait for A's tenant lock. 0033 does not enforce this.
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; SET LOCAL lock_timeout='500ms'; DELETE FROM public.role_permissions WHERE role_id='77777777-7777-4777-8777-777777777777'; COMMIT;" >"$tmpdir/revoke.log" 2>&1
status=$?
set -e
wait "$holder"
holder=""
if [[ "$status" == 0 ]]; then
  echo "FAIL SECURITY: role grant revocation bypassed the active order transaction lock" >&2
  exit 1
fi
if ! grep -q 'lock timeout' "$tmpdir/revoke.log"; then
  echo "FAIL TEST: expected lock timeout, received another error" >&2
  cat "$tmpdir/revoke.log" >&2
  exit 2
fi
echo "PASS: role grant revocation correctly serialized with order"
