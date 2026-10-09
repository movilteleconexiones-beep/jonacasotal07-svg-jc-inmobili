#!/usr/bin/env bash
# Disposable PostgreSQL only. Role deactivation must wait for an active order.
set -euo pipefail
: "${DB_URL:?DB_URL must point to a disposable PostgreSQL database}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/tests/atomic_order_fixture.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0032_atomic_sandbox_payment_order_draft.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0033_billing_revocation_lock_prototype_draft.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/experiments/inactive_role_permission_candidate.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/experiments/role_state_lock_candidate.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM public.member_permissions;
INSERT INTO public.roles(id,organization_id,active)
VALUES ('77777777-7777-4777-8777-777777777777',NULL,true);
INSERT INTO public.member_roles VALUES
 ('55555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777');
INSERT INTO public.role_permissions VALUES
 ('77777777-7777-4777-8777-777777777777','66666666-6666-4666-8666-666666666666');
SQL
tmpdir=$(mktemp -d)
holder=""
cleanup() { if [[ -n "$holder" ]]; then kill "$holder" 2>/dev/null || true; wait "$holder" 2>/dev/null || true; fi; rm -rf "$tmpdir"; }
trap cleanup EXIT
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true); SELECT set_config('request.jwt.claim.role','authenticated',true); SELECT public.create_authorized_sandbox_payment_order('22222222-2222-4222-8222-222222222222','BASIC','JCO_'||repeat('e',32)); SELECT pg_sleep(5); COMMIT;" >"$tmpdir/order.log" 2>&1 &
holder=$!
ready=0
for _ in {1..30}; do
  if psql "$DB_URL" -At -c "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE query LIKE '%pg_sleep(5)%' AND state='active' AND pid<>pg_backend_pid())" | grep -qx t; then ready=1; break; fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then cat "$tmpdir/order.log" >&2; echo "FAIL: order holder not observed" >&2; exit 2; fi
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "BEGIN; SET LOCAL lock_timeout='500ms'; UPDATE public.roles SET active=false WHERE id='77777777-7777-4777-8777-777777777777'; COMMIT;" >"$tmpdir/deactivate.log" 2>&1
status=$?
set -e
wait "$holder"
holder=""
if [[ "$status" == 0 ]]; then echo "FAIL SECURITY: role deactivation bypassed active order lock" >&2; exit 1; fi
if ! grep -q 'lock timeout' "$tmpdir/deactivate.log"; then cat "$tmpdir/deactivate.log" >&2; echo "FAIL TEST: unexpected role deactivation error" >&2; exit 2; fi
echo "PASS: role deactivation serialized with active order"
