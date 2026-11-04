#!/usr/bin/env bash
# CI ONLY: disposable PG17 fixture, never connect to Supabase or production.
set -euo pipefail
if [[ "${CI:-}" != "true" ]]; then
  echo 'Refusing to run outside GitHub CI.' >&2
  exit 2
fi
db=jco_closed_privileged_boundary_ci
psql_cmd=(psql -X -v ON_ERROR_STOP=1 -h localhost -U postgres)
read -r existing_db <<< "$("${psql_cmd[@]}" -At -d postgres -c "SELECT count(*) FROM pg_database WHERE datname='$db'")"
read -r existing_roles <<< "$("${psql_cmd[@]}" -At -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')")"
if [[ "$existing_db" != 0 || "$existing_roles" != 0 ]]; then
  echo 'Refusing to modify preexisting database or API roles.' >&2
  exit 2
fi
cleanup() {
  status=$?
  trap - EXIT
  "${psql_cmd[@]}" -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null || status=1
  "${psql_cmd[@]}" -d postgres -c 'DROP ROLE IF EXISTS anon,authenticated,service_role' >/dev/null || status=1
  exit "$status"
}
trap cleanup EXIT
"${psql_cmd[@]}" -d postgres -c "CREATE DATABASE $db" >/dev/null
"${psql_cmd[@]}" -d "$db" -f security/tests/closed_privileged_table_fixture.sql >/dev/null
check=security/checks/closed_privileged_table_boundary.sql
report() { "${psql_cmd[@]}" -d "$db" -qAt -F '|' -f "$check"; }
assert_clean() {
  local output
  output="$(report)"
  if ! printf '%s\n' "$output" | awk -F '|' '
      {count++; if ($8 != "DENY_BOUNDARY_OK") bad++}
      END {exit (count==4 && bad==0) ? 0 : 1}' ; then
    echo "Unexpected baseline: $output" >&2
    exit 1
  fi
}
assert_drift() {
  local identity="$1" output
  output="$(report)"
  if ! printf '%s\n' "$output" | awk -F '|' -v id="$identity" '
      $1==id && $8=="DRIFT" {found=1}
      END {exit found?0:1}' ; then
    echo "Expected DRIFT for $identity; observed: $output" >&2
    exit 1
  fi
}
assert_clean
"${psql_cmd[@]}" -d "$db" -c 'GRANT SELECT ON public.payment_events TO anon' >/dev/null
assert_drift public.payment_events
"${psql_cmd[@]}" -d "$db" -c 'REVOKE SELECT ON public.payment_events FROM anon' >/dev/null
assert_clean
"${psql_cmd[@]}" -d "$db" -c 'GRANT MAINTAIN ON public.payment_events TO authenticated' >/dev/null
assert_drift public.payment_events
"${psql_cmd[@]}" -d "$db" -c 'REVOKE MAINTAIN ON public.payment_events FROM authenticated' >/dev/null
assert_clean
"${psql_cmd[@]}" -d "$db" -c 'ALTER TABLE public.payment_events DISABLE ROW LEVEL SECURITY' >/dev/null
assert_drift public.payment_events
"${psql_cmd[@]}" -d "$db" -c 'ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY' >/dev/null
assert_clean
"${psql_cmd[@]}" -d "$db" -c 'CREATE POLICY unsafe_read ON public.payment_events FOR SELECT TO anon USING (true)' >/dev/null
assert_drift public.payment_events
"${psql_cmd[@]}" -d "$db" -c 'DROP POLICY unsafe_read ON public.payment_events' >/dev/null
assert_clean
"${psql_cmd[@]}" -d "$db" -c 'GRANT DELETE ON private.website_contact_consents TO anon' >/dev/null
assert_drift private.website_contact_consents
"${psql_cmd[@]}" -d "$db" -c 'REVOKE DELETE ON private.website_contact_consents FROM anon' >/dev/null
assert_clean
"${psql_cmd[@]}" -d "$db" -c 'REVOKE SELECT ON public.payment_events FROM service_role' >/dev/null
assert_drift public.payment_events
"${psql_cmd[@]}" -d "$db" -c 'GRANT SELECT ON public.payment_events TO service_role' >/dev/null
assert_clean
echo 'PASS: 4 closed billing/private tables, six negative mutations, full restore (isolated PG17).'
