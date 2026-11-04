#!/usr/bin/env bash
# INMOJCO: disposable PostgreSQL 17 fixture. Never connect to production.
set -euo pipefail
if [[ "${CI:-}" != "true" ]]; then echo 'Refusing to run outside CI' >&2; exit 2; fi
db=jco_commercial_plan_parity_ci
psql_cmd=(psql -X -v ON_ERROR_STOP=1 -h localhost -U postgres)
count="$("${psql_cmd[@]}" -qAt -d postgres -c "SELECT count(*) FROM pg_database WHERE datname='$db'")"
if [[ "$count" != 0 ]]; then echo 'Refusing to touch preexisting DB' >&2; exit 2; fi
cleanup() {
  local code=$?
  trap - EXIT
  "${psql_cmd[@]}" -q -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null || code=1
  exit "$code"
}
trap cleanup EXIT
"${psql_cmd[@]}" -q -d postgres -c "CREATE DATABASE $db" >/dev/null
"${psql_cmd[@]}" -q -d "$db" -f security/tests/commercial_plan_parity_fixture.sql >/dev/null
sql=security/checks/commercial_basic_pro_parity.sql
audit() { "${psql_cmd[@]}" -qAt -F '|' -d "$db" -f "$sql"; }
assert_clean() {
  local report
  report="$(audit)"
  if ! printf '%s\n' "$report" | awk -F '|' '
     {n++; if ($2 != "t" || $3 != "OK") failed++}
     END {exit n==6 && failed==0 ? 0 : 1}'; then
    echo "Expected 6/6 OK, observed: $report" >&2
    exit 1
  fi
}
expect_drift() {
  local label="$1" report
  report="$(audit)"
  if ! printf '%s\n' "$report" | grep -Fxq "${label}|f|DRIFT"; then
    echo "Did not detect $label drift: $report" >&2
    exit 1
  fi
}
assert_clean
"${psql_cmd[@]}" -q -d "$db" -c "UPDATE public.plans SET max_users=6 WHERE code='BASIC'" >/dev/null
expect_drift basic_5_users_and_200_properties
"${psql_cmd[@]}" -q -d "$db" -c "UPDATE public.plans SET max_users=5 WHERE code='BASIC'" >/dev/null
assert_clean
"${psql_cmd[@]}" -q -d "$db" -c "UPDATE public.plans SET price=0 WHERE code='PRO'" >/dev/null
expect_drift professional_25_users_and_2000_properties
"${psql_cmd[@]}" -q -d "$db" -c "UPDATE public.plans SET price=299900 WHERE code='PRO'" >/dev/null
assert_clean
"${psql_cmd[@]}" -q -d "$db" -c "UPDATE public.plan_features SET enabled=false WHERE plan_id=2 AND feature_key='permission:synthetic_01'" >/dev/null
expect_drift feature_lists_identical
expect_drift professional_47_enabled_features
"${psql_cmd[@]}" -q -d "$db" -c "UPDATE public.plan_features SET enabled=true WHERE plan_id=2 AND feature_key='permission:synthetic_01'" >/dev/null
assert_clean
"${psql_cmd[@]}" -q -d "$db" -c "UPDATE public.plans SET active=false WHERE code='PRO'" >/dev/null
expect_drift two_and_only_two_monthly_plans
"${psql_cmd[@]}" -q -d "$db" -c "UPDATE public.plans SET active=true WHERE code='PRO'" >/dev/null
assert_clean
"${psql_cmd[@]}" -q -d "$db" -c "INSERT INTO public.plans(code,billing_cycle,price,currency,max_users,max_properties,active) VALUES ('TRIAL','MONTHLY',0,'COP',1,10,true)" >/dev/null
expect_drift two_and_only_two_monthly_plans
"${psql_cmd[@]}" -q -d "$db" -c "DELETE FROM public.plans WHERE code='TRIAL'" >/dev/null
assert_clean
echo 'PASS: 6/6 paid-plan checks, five adversarial mutations detected (PG17 only).'
