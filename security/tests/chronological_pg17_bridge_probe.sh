#!/usr/bin/env bash
# INMOJCO #104 — probe the first 99 ledger bodies plus TWO out-of-ledger prerequisites,
# in their original Supabase ledger order, against a disposable local PG17.
# NO production Supabase URL, no migration history repair, no network operations.
set -euo pipefail

if [[ "${CI:-}" != "true" || "${GITHUB_ACTIONS:-}" != "true" ||
      -z "${RUNNER_TEMP:-}" || ! -d "$RUNNER_TEMP" ]]; then
  echo 'REFUSED: disposable PostgreSQL 17 GitHub Actions service required' >&2
  exit 2
fi
db=jco_migration_104_replay_test
psql_cmd=(psql -X -v ON_ERROR_STOP=1 -h localhost -U postgres)
pg_version="$("${psql_cmd[@]}" -qAt -d postgres -c 'SHOW server_version_num')"
if [[ ! "$pg_version" =~ ^17[0-9]{4}$ ]]; then
  echo 'REFUSED: expected local PostgreSQL 17 service' >&2
  exit 2
fi
existing_db="$("${psql_cmd[@]}" -qAt -d postgres -c "SELECT count(*) FROM pg_database WHERE datname='$db'")"
existing_roles="$("${psql_cmd[@]}" -qAt -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')")"
if [[ "$existing_db" != "0" || "$existing_roles" != "0" ]]; then
  echo 'REFUSED: replay database or API roles already exist' >&2
  exit 2
fi

workdir="$(mktemp -d "$RUNNER_TEMP/inmojco-replay-104.XXXXXX")"
archive_dir=''
owned_db=false
owned_roles=false
cleanup() {
  local code=$?
  trap - EXIT
  if [[ "$owned_db" == true ]]; then
    "${psql_cmd[@]}" -q -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null || code=1
  fi
  if [[ "$owned_roles" == true ]]; then
    "${psql_cmd[@]}" -q -d postgres -c 'DROP ROLE IF EXISTS anon,authenticated,service_role' >/dev/null || code=1
  fi
  if [[ -n "$archive_dir" && "$archive_dir" == /tmp/inmojco-104-historic-sql-* ]]; then
    rm -rf -- "$archive_dir" || code=1
  fi
  rm -rf -- "$workdir" || code=1
  exit "$code"
}
trap cleanup EXIT

"${psql_cmd[@]}" -q -d postgres -c "CREATE DATABASE $db" >/dev/null
owned_db=true
# If creation aborts after only one role, all three names were absent before.
owned_roles=true
"${psql_cmd[@]}" -q -d "$db" -f security/tests/chronological_pg17_auth_stub.sql > "$workdir/auth-fixture.log" 2>&1 || {
  echo 'ERROR: the minimal disposable Auth fixture failed' >&2
  tail -n 15 "$workdir/auth-fixture.log" >&2
  exit 1
}

# The archive generator verifies all 99 original SQL hashes and total bytes.
node scripts/ops/reconstruct-applied-99.mjs --archive-temporary > "$workdir/archive.json"
archive_dir="$(node -e 'const f=require("node:fs");const x=JSON.parse(f.readFileSync(process.argv[1],"utf8"));if(!x.ok||x.originalBodies!==99||x.bytes!==493999||x.safeToReplay!==false||!x.localArchive?.startsWith("/tmp/inmojco-104-historic-sql-"))process.exit(3);process.stdout.write(x.localArchive)' "$workdir/archive.json")"

# Read exact ledger order; never list arbitrary filesystem files or accept a
# caller-chosen version. This experiment deliberately caps at 8/99 only.
mapfile -t candidates < <(node - "$archive_dir/MANIFEST.json" <<'JS'
const fs=require('node:fs');
const m=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(m.count!==99||m.bytes!==493999||m.safeToReplay!==false||
   m.summaries.length!==99)process.exit(5);
for(const row of m.summaries.slice(0,99)) {
 if(!/^\d{14}_[a-z0-9_]+\.sql\.txt$/.test(row.filename))process.exit(6);
 console.log(row.version+'|'+row.filename);
}
JS
)
if [[ "${#candidates[@]}" != 99 ]]; then
  echo 'ERROR: historical ledger was incomplete; no replay' >&2
  exit 1
fi

# Supabase CLI normally maintains this metadata. Emulate ONLY the version
# column inside the disposable replay database, inserting after each success.
"${psql_cmd[@]}" -q -d "$db" -c 'CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY)' >/dev/null

success=0
for row in "${candidates[@]}"; do
  version="${row%%|*}"
  filename="${row#*|}"
  if [[ ! "$version" =~ ^[0-9]{14}$ ||
        ! "$filename" =~ ^[0-9]{14}_[a-z0-9_]+\.sql\.txt$ ||
        "$filename" != "$version"_* ]]; then
    echo 'ERROR: unreviewed historical file name' >&2
    exit 1
  fi
  # Artificial historical prerequisite NOT present among 99 applied bodies.
  # Never infer these SQL files were executed as actual ledger versions.
  # This bridge is useful ONLY to discover downstream dependencies in CI.
  bridge_file=''
  bridge_sha=''
  if [[ "$version" == '20261010232928' ]]; then
    bridge_file='supabase/migrations/20261010212630_property_consignment_intake.sql'
    bridge_sha='e4b252f022cf76f5ad773060ff86d33c29ef564c'
  elif [[ "$version" == '20261010232930' ]]; then
    bridge_file='supabase/migrations/20261010214633_fix_property_portal_rls_recursion.sql'
    bridge_sha='e6cb9a3923328158a42c86644fb4a591df25eba9'
  fi
  if [[ -n "$bridge_file" ]]; then
    if [[ "$(git hash-object "$bridge_file")" != "$bridge_sha" ]]; then
      echo "FAIL: unreviewed synthetic historical bridge at $version" >&2
      exit 1
    fi
    if ! "${psql_cmd[@]}" -q -d "$db" -f "$bridge_file" > "$workdir/bridge-$version.log" 2>&1; then
      echo "FAIL: synthetic bridge prerequisite for $version (not in 99 registered migrations)" >&2
      tail -n 15 "$workdir/bridge-$version.log" >&2
      exit 1
    fi
    echo "BRIDGE: added locally pinned SQL outside the 99-ledger before $version (NOT proof of production origin)"
  fi
  # #325: Supabase preview branches do NOT inherit default public grants.
  # The older disposable Auth stub grants ALL to service_role, which masked
  # the third real staging failure on the final commercial ACL migration.
  # Prove the unprivileged replay fails first; then apply the missing grant
  # ONLY inside this disposable PG17 database and replay the same original SQL.
  if [[ "$version" == '20261031032350' ]]; then
    "${psql_cmd[@]}" -q -d "$db" -c \
      'REVOKE UPDATE ON TABLE public.organizations FROM service_role' \
      > "$workdir/service-role-revoke.log" 2>&1
    service_update="$("${psql_cmd[@]}" -qAt -d "$db" -c \
      "SELECT has_column_privilege('service_role','public.organizations','plan_id','UPDATE')")"
    if [[ "$service_update" != 'f' ]]; then
      echo 'FAIL: synthetic branch cannot reproduce restricted service_role UPDATE' >&2
      exit 1
    fi
    if "${psql_cmd[@]}" -q -d "$db" -f "$archive_dir/readonly-sql/$filename" \
       > "$workdir/expected-service-role-denial.log" 2>&1; then
      echo 'FAIL: canonical migration incorrectly passed without service_role UPDATE' >&2
      exit 1
    fi
    if ! grep -Fq 'Trusted billing service lost commercial update access' \
       "$workdir/expected-service-role-denial.log"; then
      echo 'FAIL: third staging dependency produced an unexpected error' >&2
      tail -n 15 "$workdir/expected-service-role-denial.log" >&2
      exit 1
    fi
    "${psql_cmd[@]}" -q -d "$db" -c \
      'GRANT UPDATE ON TABLE public.organizations TO service_role' \
      > "$workdir/service-role-bridge.log" 2>&1
    service_update="$("${psql_cmd[@]}" -qAt -d "$db" -c \
      "SELECT has_column_privilege('service_role','public.organizations','plan_id','UPDATE')")"
    if [[ "$service_update" != 't' ]]; then
      echo 'FAIL: isolated bridge did not restore trusted commercial UPDATE' >&2
      exit 1
    fi
    echo 'BRIDGE: verified third missing staging ACL and repaired ONLY disposable PG17'
  fi
  # Fail at the exact version and stop. No production SQL has been invoked.
  if ! "${psql_cmd[@]}" -q -d "$db" -f "$archive_dir/readonly-sql/$filename"         > "$workdir/step-$version.log" 2>&1; then
    echo "FAIL: isolated chronological SQL replay at version $version, after $success successful original bodies" >&2
    tail -n 18 "$workdir/step-$version.log" >&2
    exit 1
  fi
  success=$((success+1))
  "${psql_cmd[@]}" -q -d "$db" -c "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('$version')" >/dev/null
  echo "PG17 bridge-assisted chronological probe PASS $success/99 version $version"
done

# Compare current physical metadata against the pinned live production
# reference. This is a diagnostic, NOT a certification of API, Auth or tenant data.
for query_kind in consignment portal; do
  if [[ "$query_kind" == consignment ]]; then
    check_sql=security/checks/consignment_restore_shape_fingerprint.sql
    expected_count=14
  else
    check_sql=security/checks/unmatched_three_current_live_preflight.sql
    expected_count=10
  fi
  output_file="$workdir/catalog-$query_kind.txt"
  "${psql_cmd[@]}" -qAt -F '|' -d "$db" -f "$check_sql" > "$output_file"
  rows="$(wc -l < "$output_file" | tr -d '[:space:]')"
  if [[ "$rows" != "$expected_count" ]]; then
    echo "ERROR: reconstructed $query_kind catalog returned $rows/$expected_count findings" >&2
    exit 1
  fi
  ok="$(awk -F '|' '$3=="OK"{n++} END{print n+0}' "$output_file")"
  echo "CATALOG COMPARISON, NOT GO: $query_kind $ok/$expected_count match production reference"
  if [[ "$ok" != "$expected_count" ]]; then
    grep -v '|OK$' "$output_file" >&2 || true
    echo "FAIL: isolated $query_kind catalog differs from pinned production reference" >&2
    exit 1
  fi
done

# Check actual physical state, not just psql's exit code.
found="$("${psql_cmd[@]}" -qAt -d "$db" -c "
SELECT count(*) FROM pg_class c
WHERE c.oid IN (
  to_regclass('public.organizations'),to_regclass('public.organization_members'),
  to_regclass('public.profiles'),to_regclass('public.properties'),
  to_regclass('public.contacts'),to_regclass('public.leads'),
  to_regclass('public.deals'),to_regclass('public.audit_log')
) AND c.relkind='r'")"
if [[ "$found" != "8" ]]; then
  echo "FAIL: only $found/8 expected physical tables after historical replay" >&2
  exit 1
fi
rls="$("${psql_cmd[@]}" -qAt -d "$db" -c "
SELECT count(*) FROM pg_class c WHERE c.oid IN (
 to_regclass('public.properties'),to_regclass('public.contacts'),
 to_regclass('public.leads'),to_regclass('public.deals'))
 AND c.relrowsecurity")"
if [[ "$rls" != "4" ]]; then
  echo "FAIL: only $rls/4 expected tenant RLS tables enabled" >&2
  exit 1
fi
account_count="$("${psql_cmd[@]}" -qAt -d "$db" -c 'SELECT count(*) FROM auth.users')"
[[ "$account_count" == "0" ]]
echo 'PASS: 99/99 SQL sources applied with two synthetic prerequisites on disposable PG17, 8 tables and 4 RLS guards verified; physical checks do not certify Supabase Auth/Storage; #104 still NO-GO'
