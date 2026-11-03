#!/usr/bin/env bash
set -euo pipefail
# Synthetic PostgreSQL 17 acceptance test. No external Wompi calls.
export PGHOST=localhost PGUSER=postgres PGDATABASE=jco_billing_serialization_test PGPASSWORD=postgres
psql_ci() { psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -At "$@"; }
[[ "$(psql_ci -c 'SELECT current_database()')" == 'jco_billing_serialization_test' ]] || {
  echo 'REFUSED: test must use dedicated synthetic billing database' >&2; exit 2;
}
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
org_a='11111111-1111-4111-8111-111111111111'
org_b='22222222-2222-4222-8222-222222222222'
actor_a='11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
actor_b='22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
member_a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
member_b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
perm='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
order() {
  local organization="$1" actor="$2" reference="$3"
  printf "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','%s',false); SELECT set_config('request.jwt.claim.role','authenticated',false); SELECT public.create_authorized_sandbox_payment_order('%s','BASIC','%s');" \
    "$actor" "$organization" "$reference"
}
orders_count() { psql_ci -c "SELECT count(*) FROM public.payment_orders WHERE organization_id='$1'"; }
[[ "$(orders_count "$org_a")" == 3 && "$(orders_count "$org_b")" == 3 ]] || {
  echo 'FAIL: prior synthetic tests not completed in expected order' >&2; exit 1;
}
# Both members receive explicit ALLOW for this completely synthetic load run.
psql_ci -c "INSERT INTO public.member_permissions(organization_member_id,permission_id,effect)
 VALUES('$member_a','$perm','ALLOW'),('$member_b','$perm','ALLOW')
 ON CONFLICT(organization_member_id,permission_id) DO UPDATE SET effect=excluded.effect;" >/dev/null

# Competing transaction holds the exact lock used by the order RPC.
retry_ref='JCO_ffffffffffffffffffffffffffffa001'
psql_ci -c "BEGIN; SELECT pg_advisory_xact_lock(hashtext('inmojco.billing.authorization'),0); SELECT pg_sleep(0.9); COMMIT;" >"$tmp/holder" 2>&1 &
holder_pid=$!
sleep 0.15
before="$(orders_count "$org_a")"
set +e
PGOPTIONS='-c lock_timeout=150ms -c statement_timeout=2000ms' \
  psql_ci -c "$(order "$org_a" "$actor_a" "$retry_ref")" >"$tmp/blocked" 2>&1
blocked_status=$?
set -e
wait "$holder_pid"
[[ "$blocked_status" -ne 0 ]] && grep -q '55P03' "$tmp/blocked" || {
  echo 'FAIL: bounded billing lock did not raise expected SQLSTATE 55P03' >&2
  cat "$tmp/holder" "$tmp/blocked" >&2; exit 1;
}
[[ "$(orders_count "$org_a")" == "$before" ]] || {
  echo 'FAIL: timed-out order inserted a row' >&2; exit 1;
}
# Re-use the SAME unique reference after an explicit retryable failure.
psql_ci -c "$(order "$org_a" "$actor_a" "$retry_ref")" >"$tmp/retry" 2>&1
[[ "$(orders_count "$org_a")" == "$((before+1))" ]] || exit 1
[[ "$(psql_ci -c "SELECT count(*) FROM public.payment_orders WHERE reference='$retry_ref'")" == 1 ]] || exit 1

# Running the same reference again must never create a second order.
set +e
psql_ci -c "$(order "$org_a" "$actor_a" "$retry_ref")" >"$tmp/duplicate" 2>&1
duplicate_status=$?
set -e
[[ "$duplicate_status" -ne 0 ]] && grep -q '23505' "$tmp/duplicate" || {
  echo 'FAIL: idempotent reference accepted twice' >&2; exit 1;
}

# Bursty demand across A and B: 16 connections in batches of four.
pids=()
for n in $(seq 1 16); do
  reference="$(printf 'JCO_%032x' "$((30000+n))")"
  if ((n % 2 == 0)); then
    org="$org_a"; actor="$actor_a"
  else
    org="$org_b"; actor="$actor_b"
  fi
  (
    PGOPTIONS='-c lock_timeout=6000ms -c statement_timeout=9000ms' \
      psql_ci -c "$(order "$org" "$actor" "$reference")"
  ) >"$tmp/load-$n" 2>&1 &
  pids+=("$!")
  if ((n % 4 == 0)); then
    for pid in "${pids[@]}"; do
      if ! wait "$pid"; then
        echo 'FAIL: a concurrent order was rejected or timed out' >&2
        grep -H 'ERROR:' "$tmp"/load-* >&2 || true
        exit 1
      fi
    done
    pids=()
  fi
done
[[ "$(orders_count "$org_a")" == 12 ]] || {
  echo "FAIL: expected 12 A orders, got $(orders_count "$org_a")" >&2; exit 1;
}
[[ "$(orders_count "$org_b")" == 11 ]] || {
  echo "FAIL: expected 11 B orders, got $(orders_count "$org_b")" >&2; exit 1;
}
[[ "$(psql_ci -c "SELECT count(*) FROM public.payment_orders
 WHERE provider='WOMPI' AND environment='sandbox' AND currency='COP'
 AND amount_in_cents=14900000")" == 23 ]] || exit 1

echo 'PASS: 55P03 lock timeout leaves no partial order; safe same-reference retry; duplicate rejected; 16 concurrent cross-tenant orders have exact COP totals'
