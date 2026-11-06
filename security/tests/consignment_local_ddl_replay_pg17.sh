#!/usr/bin/env bash
# INMOJCO #104: CI-ONLY disposable PostgreSQL 17 replay of LOCAL consignment DDL.
# Never use Supabase production, tenant data, migration repair or schema push.
set -euo pipefail

# pg17 is a disposable GitHub Actions service on localhost. The job's regular
# postgres database and any preexisting API roles MUST survive this test.
if [[ "${CI:-}" != "true" || "${GITHUB_ACTIONS:-}" != "true" ||
      -z "${RUNNER_TEMP:-}" || ! -d "$RUNNER_TEMP" ]]; then
  echo 'Refusing replay outside GitHub CI with a disposable local PG17 service.' >&2
  exit 2
fi

db=jco_consignment_ddl_replay_test
psql_cmd=(psql -X -v ON_ERROR_STOP=1 -h localhost -U postgres)
existing_db="$("${psql_cmd[@]}" -qAt -d postgres -c   "SELECT count(*) FROM pg_database WHERE datname='$db'")"
existing_roles="$("${psql_cmd[@]}" -qAt -d postgres -c   "SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')")"
if [[ "$existing_db" != "0" || "$existing_roles" != "0" ]]; then
  echo 'Refusing to touch a preexisting DB or anon/authenticated/service_role roles.' >&2
  exit 2
fi

# The temp directory is private to this job; never overwrite a fixed file.
workdir="$(mktemp -d "$RUNNER_TEMP/consignment-ddl.XXXXXX")"
owned_db=false
owned_roles=false
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$owned_db" == true ]]; then
    "${psql_cmd[@]}" -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null || status=1
  fi
  if [[ "$owned_roles" == true ]]; then
    "${psql_cmd[@]}" -d postgres -c 'DROP ROLE IF EXISTS anon, authenticated, service_role' >/dev/null || status=1
  fi
  rm -rf -- "$workdir" || status=1
  exit "$status"
}
trap cleanup EXIT

"${psql_cmd[@]}" -d postgres -c "CREATE DATABASE $db" >/dev/null
owned_db=true
# Roles may have been partly created when the fixture fails. None existed
# before this invocation; this job owns only these temporary test roles.
owned_roles=true
"${psql_cmd[@]}" -d "$db" -f security/tests/consignment_local_ddl_replay_fixture.sql >/dev/null

# Review original physical DDL only; never execute the later privileged RPCs.
src=supabase/migrations/20261010212630_property_consignment_intake.sql
test "$(grep -c '^-- This old policy exposed' "$src")" -eq 1
test "$(grep -c '^create table private.property_intake_sites' "$src")" -eq 1
test "$(grep -c '^create table public.property_consignments' "$src")" -eq 1
script="$workdir/consignment-ddl-only.sql"
awk '/^-- This old policy exposed/{exit} {print} END{print "COMMIT;"}' "$src" > "$script"
"${psql_cmd[@]}" -d "$db" -f "$script" >/dev/null

sql_check=security/checks/consignment_restore_shape_fingerprint.sql
report="$workdir/consignment-ddl-shape.txt"
"${psql_cmd[@]}" -qAt -F '|' -d "$db" -f "$sql_check" > "$report"
test "$(wc -l < "$report")" -eq 14

# ACL/RLS policies evolved after the historical DDL. Compare six original
# physical contracts only, and fail on all missing rows or any drift.
awk -F '|' '
  ($1 == "private.property_intake_sites" || $1 == "public.property_consignments") &&
  ($2 == "COLUMNS" || $2 == "CONSTRAINTS" || $2 == "INDEXES") {
    checked++;
    if ($3 != "OK") bad++;
  }
  END { if (checked != 6 || bad != 0) exit 1 }
' "$report" || {
  echo 'ERROR: local historical physical DDL differs from pinned live schema fingerprints' >&2
  grep -E 'COLUMNS|CONSTRAINTS|INDEXES' "$report" >&2
  exit 1
}
"${psql_cmd[@]}" -d "$db" -c   'ALTER TABLE public.property_consignments ADD COLUMN unexpected_historical_drift boolean' >/dev/null
"${psql_cmd[@]}" -qAt -F '|' -d "$db" -f "$sql_check" > "$workdir/consignment-mutated-shape.txt"
grep -Fxq 'public.property_consignments|COLUMNS|DRIFT'   "$workdir/consignment-mutated-shape.txt"
echo 'PASS: replayed local table DDL, rejected mutation, and preserved existing PG17 resources; migration ledger remains NO-GO'
