#!/usr/bin/env bash
set -euo pipefail
# Dedicated, synthetic PostgreSQL 17 CI test; NEVER use with a live Supabase DB.
export PGHOST=localhost PGUSER=postgres PGDATABASE=jco_role_perms_test PGPASSWORD=postgres
psql_ci() { psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -At "$@"; }
[[ "$(psql_ci -c 'SELECT current_database()')" == 'jco_role_perms_test' ]] || {
  echo 'REFUSED: isolated role-permission CI database required' >&2; exit 2;
}
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
agency='11111111-1111-4111-8111-111111111111'
agency_b='22222222-2222-4222-8222-222222222222'
advisor_role='10000000-0000-4000-9000-000000000002'
admin='a0000000-0000-4000-8000-000000000001'
other_admin='20000000-0000-4000-9000-000000000001'

permission_state() {
  psql_ci -c "SELECT coalesce(string_agg(p.key,',' ORDER BY p.key),'') FROM public.role_permissions rp JOIN public.permissions p ON rp.permission_id=p.id WHERE rp.role_id='$advisor_role';"
}
audit_count() {
  psql_ci -c "SELECT count(*) FROM public.audit_log WHERE action='role.permissions_changed' AND entity_id='$advisor_role';"
}
other_tenant_count() {
  psql_ci -c "SELECT count(*) FROM public.role_permissions WHERE role_id='$other_admin';"
}
rpc_edit() {
  local desired="$1" expected="$2"
  printf "SET ROLE authenticated; SELECT set_config('jco_test.actor','%s',false); SELECT public.admin_update_role_permissions('%s','%s',ARRAY[%s]::text[],ARRAY[%s]::text[]);" \
    "$admin" "$agency" "$advisor_role" "$desired" "$expected"
}
run_race() {
  local label="$1" expected="$2" desired_first="$3" desired_stale="$4" expected_after="$5" expected_audits="$6"
  [[ "$(permission_state)" == "$expected" ]] || {
    echo "FAIL $label: unexpected baseline permissions" >&2; exit 1;
  }
  local first=0 second=0
  # The first session holds the role-row FOR UPDATE lock until COMMIT.
  psql_ci -c "BEGIN; $(rpc_edit "$desired_first" "'$expected'") SELECT pg_sleep(0.75); COMMIT;" >"$tmp/$label-first" 2>&1 &
  local first_pid=$!
  sleep 0.15
  psql_ci -c "$(rpc_edit "$desired_stale" "'$expected'")" >"$tmp/$label-stale" 2>&1 &
  local second_pid=$!
  wait "$first_pid" || first=$?
  wait "$second_pid" || second=$?
  if [[ "$first" -ne 0 || "$second" -eq 0 ]]; then
    echo "FAIL $label: expected committed first edit and rejected stale second edit" >&2
    cat "$tmp/$label-first" "$tmp/$label-stale" >&2; exit 1
  fi
  if ! grep -q '40001' "$tmp/$label-stale"; then
    echo "FAIL $label: stale concurrent change must return SQLSTATE 40001" >&2
    cat "$tmp/$label-stale" >&2; exit 1
  fi
  [[ "$(permission_state)" == "$expected_after" ]] || {
    echo "FAIL $label: stale edit overwrote committed permissions" >&2; exit 1;
  }
  [[ "$(audit_count)" == "$expected_audits" ]] || {
    echo "FAIL $label: concurrent attempt created an extra/missing audit event" >&2; exit 1;
  }
  [[ "$(other_tenant_count)" == 9 ]] || {
    echo "FAIL $label: different agency's administrator permissions changed" >&2; exit 1;
  }
}

# The existing fixture + assertions leave this AGENT role with leases.view only;
# previous changes in the same database created exactly two advisor audit rows.
[[ "$(permission_state)" == 'leases.view' ]] || exit 1
[[ "$(audit_count)" == 2 ]] || exit 1
[[ "$(other_tenant_count)" == 9 ]] || exit 1

# Session A revokes leases.view while granting properties.view. B has the same
# stale expected version and tries to remove everything: its edit MUST fail.
run_race 'revoke-lease' 'leases.view' "'properties.view'" "" 'properties.view' 3
# Confirm authorization is revoked for a freshly evaluated AGENT session.
[[ "$(psql_ci -c "SELECT set_config('jco_test.actor','a0000000-0000-4000-8000-000000000002',false); SELECT public.has_org_permission('$agency','leases.view')" | tail -n 1)" == 'f' ]] || {
  echo 'FAIL: advisor lease permission survived a committed revocation' >&2; exit 1;
}

# Session A revokes properties.view while granting leases.view. B's old
# permissions snapshot can no longer remove or overwrite the new choice.
run_race 'revoke-property' 'properties.view' "'leases.view'" "" 'leases.view' 4
[[ "$(psql_ci -c "SELECT set_config('jco_test.actor','a0000000-0000-4000-8000-000000000002',false); SELECT public.has_org_permission('$agency','properties.view')" | tail -n 1)" == 'f' ]] || {
  echo 'FAIL: advisor property permission survived a committed revocation' >&2; exit 1;
}
echo 'PASS: two stale concurrent role edits rejected, committed revocations effective, independent agency unchanged, audit preserved'
