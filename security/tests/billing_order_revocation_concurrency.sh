#!/usr/bin/env bash
set -euo pipefail
# PostgreSQL 17 CI fixture ONLY: no Wompi API, no live organization records.
export PGHOST=localhost PGUSER=postgres PGDATABASE=jco_billing_serialization_test PGPASSWORD=postgres
psql_ci() { psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -At "$@"; }
[[ "$(psql_ci -c 'SELECT current_database()')" == 'jco_billing_serialization_test' ]] || {
  echo 'REFUSED: dedicated synthetic CI database required' >&2; exit 2;
}
logs="$(mktemp -d)"
trap 'rm -rf "$logs"' EXIT
org_a='11111111-1111-4111-8111-111111111111'
org_b='22222222-2222-4222-8222-222222222222'
member_a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
role_a='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
perm='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
actor_a='11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
actor_b='22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
seq=0
order_sql() {
  local org="$1" actor="$2" ref="$3"
  printf "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','%s',false); SELECT set_config('request.jwt.claim.role','authenticated',false); SELECT public.create_authorized_sandbox_payment_order('%s','BASIC','%s');" "$actor" "$org" "$ref"
}
order_ref() {
  printf 'JCO_%032x' "$1"
}
assert_count() {
  local expected="$1" actual
  actual="$(psql_ci -c "SELECT count(*) FROM public.payment_orders WHERE organization_id='$org_a'")"
  [[ "$actual" == "$expected" ]] || {
    echo "FAIL: expected $expected A orders; got $actual" >&2; exit 1;
  }
}
# Allowed sequential reference scenario, then revocation runs second.
# The first order stays uncommitted while the other session requests a change.
run_two() {
  local label="$1" first_sql="$2" second_sql="$3" expect_first="$4" expect_second="$5"
  local code_a=0 code_b=0
  psql_ci -c "BEGIN; $first_sql SELECT pg_sleep(0.7); COMMIT;" >"$logs/$label-a" 2>&1 &
  local first_pid=$!
  sleep 0.15
  psql_ci -c "$second_sql" >"$logs/$label-b" 2>&1 &
  local second_pid=$!
  wait "$first_pid" || code_a=$?
  wait "$second_pid" || code_b=$?
  if [[ "$expect_first" == success && "$code_a" != 0 ]] ||
     [[ "$expect_first" == failure && "$code_a" == 0 ]] ||
     [[ "$expect_second" == success && "$code_b" != 0 ]] ||
     [[ "$expect_second" == failure && "$code_b" == 0 ]]; then
    echo "FAIL $label: unexpected transaction outcome $code_a/$code_b" >&2
    cat "$logs/$label-a" "$logs/$label-b" >&2
    exit 1
  fi
  local wanted='42501'
  [[ "$label" == 'duplicate-reference' ]] && wanted='23505'
  if [[ "$expect_second" == failure ]] && ! grep -q "$wanted" "$logs/$label-b"; then
    echo "FAIL $label: rejection expected SQLSTATE $wanted" >&2
    cat "$logs/$label-b" >&2; exit 1;
  fi
}
set_allow() {
  psql_ci -c "INSERT INTO public.member_permissions(organization_member_id,permission_id,effect) VALUES('$member_a','$perm','ALLOW') ON CONFLICT(organization_member_id,permission_id) DO UPDATE SET effect='ALLOW';" >/dev/null
}
reset_roles() {
  psql_ci -c "INSERT INTO public.member_roles(organization_member_id,role_id) VALUES('$member_a','$role_a') ON CONFLICT DO NOTHING;
              INSERT INTO public.role_permissions(role_id,permission_id) VALUES('$role_a','$perm') ON CONFLICT DO NOTHING;" >/dev/null
}
set_allow
assert_count 0
seq=$((seq+1)); ref="$(order_ref "$seq")"
run_two 'order-then-deny' "$(order_sql "$org_a" "$actor_a" "$ref")" \
  "UPDATE public.member_permissions SET effect='DENY' WHERE organization_member_id='$member_a' AND permission_id='$perm';" \
  success success
assert_count 1
# The new permission state takes effect when evaluated on a fresh statement.
deny_seq=$((seq+1)); ref="$(order_ref "$seq")"
set +e
psql_ci -c "$(order_sql "$org_a" "$actor_a" "$deny_ref")" >"$logs/deny-test" 2>&1
status=$?
set -e
[[ "$status" -ne 0 ]] && grep -q '42501' "$logs/deny-test" || {
  echo 'FAIL: order allowed after revocation committed' >&2; cat "$logs/deny-test" >&2; exit 1;
}
assert_count 1

set_allow
seq=$((seq+1)); ref="$(order_ref "$seq")"
run_two 'deny-then-order' \
  "UPDATE public.member_permissions SET effect='DENY' WHERE organization_member_id='$member_a' AND permission_id='$perm';" \
  "$(order_sql "$org_a" "$actor_a" "$ref")" success failure
assert_count 1

# Recreate role-based grant without explicit ALLOW.
psql_ci -c "DELETE FROM public.member_permissions WHERE organization_member_id='$member_a' AND permission_id='$perm';" >/dev/null
reset_roles
seq=$((seq+1)); ref="$(order_ref "$seq")"
run_two 'role-grant-then-order' \
  "DELETE FROM public.role_permissions WHERE role_id='$role_a' AND permission_id='$perm';" \
  "$(order_sql "$org_a" "$actor_a" "$ref")" success failure
assert_count 1
reset_roles
seq=$((seq+1)); ref="$(order_ref "$seq")"
run_two 'member-role-then-order' \
  "DELETE FROM public.member_roles WHERE organization_member_id='$member_a' AND role_id='$role_a';" \
  "$(order_sql "$org_a" "$actor_a" "$ref")" success failure
assert_count 1
reset_roles
set_allow
seq=$((seq+1)); ref="$(order_ref "$seq")"
run_two 'inactive-member-then-order' \
  "UPDATE public.organization_members SET status='INACTIVE' WHERE id='$member_a';" \
  "$(order_sql "$org_a" "$actor_a" "$ref")" success failure
assert_count 1
psql_ci -c "UPDATE public.organization_members SET status='ACTIVE' WHERE id='$member_a';" >/dev/null
seq=$((seq+1)); ref="$(order_ref "$seq")"
run_two 'suspended-org-then-order' \
  "UPDATE public.organizations SET status='SUSPENDED' WHERE id='$org_a';" \
  "$(order_sql "$org_a" "$actor_a" "$ref")" success failure
assert_count 1
psql_ci -c "UPDATE public.organizations SET status='ACTIVE' WHERE id='$org_a';" >/dev/null
set_allow

# Two identical valid requests must produce only one pending order.
seq=$((seq+1)); ref="$(order_ref "$seq")"
sql="$(order_sql "$org_a" "$actor_a" "$ref")"
run_two 'duplicate-reference' "$sql" "$sql" success failure
assert_count 2
# A distinct organization is unaffected and uses the plan's trusted COP price.
seq=$((seq+1)); ref="$(order_ref "$seq")"
psql_ci -c "$(order_sql "$org_b" "$actor_b" "$ref")" >/dev/null
psql_ci -c "DO \$verify\$ BEGIN
 IF (SELECT count(*) FROM public.payment_orders)<>3
    OR (SELECT count(*) FROM public.payment_orders WHERE environment='sandbox'
        AND provider='WOMPI' AND currency='COP' AND amount_in_cents=14900000)<>3
 THEN RAISE EXCEPTION 'Sandbox order totals or pricing mismatch'; END IF;
 END \$verify\$;" >/dev/null
echo 'PASS: locked order creation vs DENY, role-grant/member-role revocation, member suspension, tenant suspension, duplicate reference and other tenant'
