#!/usr/bin/env bash
# INMOJCO #104: disposable PostgreSQL 17 replays local consignment DDL.
# No tenant data, live Supabase connections, production writes or repair.
set -euo pipefail
db=jco_consignment_ddl_replay_test
psql_cmd=(psql -X -v ON_ERROR_STOP=1 -h localhost -U postgres)
cleanup() {
  status=$?
  trap - EXIT
  "${psql_cmd[@]}" -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" || status=1
  "${psql_cmd[@]}" -d postgres -c "DROP ROLE IF EXISTS anon, authenticated, service_role" || status=1
  exit "$status"
}
trap cleanup EXIT
"${psql_cmd[@]}" -d postgres -c "CREATE DATABASE $db"
"${psql_cmd[@]}" -d "$db" -f security/tests/consignment_local_ddl_replay_fixture.sql
# Review only original physical schema, stopping before RPC definitions.
src=supabase/migrations/20261010212630_property_consignment_intake.sql
test "$(grep -c '^-- This old policy exposed' "$src")" -eq 1
test "$(grep -c '^create table private.property_intake_sites' "$src")" -eq 1
test "$(grep -c '^create table public.property_consignments' "$src")" -eq 1
script="$RUNNER_TEMP/consignment-ddl-only.sql"
awk '/^-- This old policy exposed/{exit} {print} END{print "COMMIT;"}' "$src" > "$script"
"${psql_cmd[@]}" -d "$db" -f "$script"
sql_check=security/checks/consignment_restore_shape_fingerprint.sql
report="$RUNNER_TEMP/consignment-ddl-shape.txt"
"${psql_cmd[@]}" -qAt -F '|' -d "$db" -f "$sql_check" > "$report"
test "$(wc -l < "$report")" -eq 14
# Current policies/ACL may have evolved: compare six physical DDL contracts.
awk -F '|' '
  ($1 == "private.property_intake_sites" || $1 == "public.property_consignments") &&
  ($2 == "COLUMNS" || $2 == "CONSTRAINTS" || $2 == "INDEXES") {
    checked++;
    if ($3 != "OK") bad++;
  }
  END { if (checked != 6 || bad != 0) exit 1 }
' "$report" || {
  echo 'ERROR: local historical physical DDL differs from pinned live schema fingerprints'
  grep -E 'COLUMNS|CONSTRAINTS|INDEXES' "$report"
  exit 1
}
"${psql_cmd[@]}" -d "$db" -c \
  'ALTER TABLE public.property_consignments ADD COLUMN unexpected_historical_drift boolean'
"${psql_cmd[@]}" -qAt -F '|' -d "$db" -f "$sql_check" \
  > "$RUNNER_TEMP/consignment-mutated-shape.txt"
grep -Fxq 'public.property_consignments|COLUMNS|DRIFT' \
  "$RUNNER_TEMP/consignment-mutated-shape.txt"
echo 'PASS: replayed original table DDL and detected synthetic divergence; applied ledger remains NO-GO'
