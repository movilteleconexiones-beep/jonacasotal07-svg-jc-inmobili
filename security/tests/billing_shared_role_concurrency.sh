#!/usr/bin/env bash
set -euo pipefail
# Shared role and deadlock regression. Synthetic PostgreSQL 17 CI DB ONLY.
export PGHOST=localhost PGUSER=postgres PGDATABASE=jco_billing_serialization_test PGPASSWORD=postgres
psql_ci() { psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -At "$@"; }
[[ "$(psql_ci -c 'SELECT current_database()')" == 'jco_billing_serialization_test' ]] || {
  echo 'REFUSED: not an isolated billing fixture' >&2; exit 2;
}
# Fail on a surprise deadlock/long wait instead of hanging GitHub Actions.
export PGOPTIONS='-c lock_timeout=4s -c statement_timeout=8s'
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
org_a='11111111-1111-4111-8111-111111111111'
org_b='22222222-2222-4222-8222-222222222222'
actor_a='11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
actor_b='22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
member_a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
member_b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
perm='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
shared='99999999-9999-4999-8999-999999999999'
order_sql() {
  local org="$1" user="$2" reference="$3"
  printf "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','%s',false); SELECT set_config('request.jwt.claim.role','authenticated',false); SELECT public.create_authorized_sandbox_payment_order('%s','BASIC','%s');" \
    "$user" "$org" "$reference"
}
count_orders() {
  psql_ci -c "SELECT count(*) FROM public.payment_orders WHERE organization_id='$1'"
}
# Existing race suite ends with two A orders and one B order.
[[ "$(count_orders "$org_a")" == 2 && "$(count_orders "$org_b")" == 1 ]] || {
  echo 'FAIL: expected previous concurrency fixture accounting' >&2; exit 1;
}
# Add a synthetic shared role used by both organizations.
psql_ci -c "INSERT INTO public.roles(id,organization_id,active) VALUES('$shared',NULL,true);
 INSERT INTO public.member_roles(organization_member_id,role_id) VALUES
 ('$member_a','$shared'),('$member_b','$shared');
 INSERT INTO public.role_permissions(role_id,permission_id) VALUES('$shared','$perm');
 DELETE FROM public.member_permissions WHERE organization_member_id='$member_a';
 DELETE FROM public.role_permissions WHERE role_id IN
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');" >"$out/setup" 2>&1
# Both agents are now authorized by the shared role alone.
psql_ci -c "$(order_sql "$org_a" "$actor_a" 'JCO_ffffffffffffffffffffffffffffff10')" >"$out/authorized-a"
psql_ci -c "$(order_sql "$org_b" "$actor_b" 'JCO_ffffffffffffffffffffffffffffff11')" >"$out/authorized-b"
[[ "$(count_orders "$org_a")" == 3 && "$(count_orders "$org_b")" == 2 ]] || exit 1

# Revoke a role permission used in both tenants; authorization reads must wait
# until COMMIT, then reject both without deadlock (SQLSTATE 40P01).
psql_ci -c "BEGIN; DELETE FROM public.role_permissions WHERE role_id='$shared' AND permission_id='$perm'; SELECT pg_sleep(0.7); COMMIT;" >"$out/revoke" 2>&1 &
revoke_pid=$!
sleep 0.15
a_status=0 b_status=0
psql_ci -c "$(order_sql "$org_a" "$actor_a" 'JCO_ffffffffffffffffffffffffffffff12')" >"$out/denied-a" 2>&1 || a_status=$?
psql_ci -c "$(order_sql "$org_b" "$actor_b" 'JCO_ffffffffffffffffffffffffffffff13')" >"$out/denied-b" 2>&1 || b_status=$?
wait "$revoke_pid"
[[ "$a_status" -ne 0 && "$b_status" -ne 0 ]] || {
  echo 'FAIL: shared role revocation left a tenant authorized' >&2; exit 1;
}
grep -q '42501' "$out/denied-a" && grep -q '42501' "$out/denied-b" || {
  echo 'FAIL: revoked shared role must return authorization denied' >&2
  cat "$out/denied-a" "$out/denied-b" >&2; exit 1;
}
! grep -q '40P01' "$out/revoke" "$out/denied-a" "$out/denied-b" || {
  echo 'FAIL: deadlock in shared-role order/revocation path' >&2; exit 1;
}
[[ "$(count_orders "$org_a")" == 3 && "$(count_orders "$org_b")" == 2 ]] || exit 1

# Reverse ordering: a successful authorized order must commit before
# the shared permission is revoked; no later order may pass.
psql_ci -c "INSERT INTO public.role_permissions(role_id,permission_id) VALUES('$shared','$perm')" >/dev/null
first_status=0 second_status=0
psql_ci -c "BEGIN; $(order_sql "$org_b" "$actor_b" 'JCO_ffffffffffffffffffffffffffffff14') SELECT pg_sleep(0.7); COMMIT;" >"$out/order-first" 2>&1 &
first_pid=$!
sleep 0.15
psql_ci -c "DELETE FROM public.role_permissions WHERE role_id='$shared' AND permission_id='$perm';" >"$out/revoke-second" 2>&1 || second_status=$?
wait "$first_pid" || first_status=$?
[[ "$first_status" == 0 && "$second_status" == 0 ]] || {
  echo 'FAIL: order-first/revoke-second failed' >&2; cat "$out/order-first" "$out/revoke-second" >&2; exit 1;
}
[[ "$(count_orders "$org_a")" == 3 && "$(count_orders "$org_b")" == 3 ]] || exit 1
final_status=0
psql_ci -c "$(order_sql "$org_b" "$actor_b" 'JCO_ffffffffffffffffffffffffffffff15')" >"$out/final-deny" 2>&1 || final_status=$?
[[ "$final_status" -ne 0 ]] && grep -q '42501' "$out/final-deny" || {
  echo 'FAIL: new order after shared role revocation accepted' >&2; exit 1;
}
echo 'PASS: shared role across two tenants serializes orders and revocation without deadlocks'
