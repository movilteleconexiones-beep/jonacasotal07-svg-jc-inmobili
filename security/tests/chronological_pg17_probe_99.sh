#!/usr/bin/env bash
# INMOJCO #104 — execute only the first 99 actual historical SQL bodies,
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
  # Fail at the exact version and stop. No production SQL has been invoked.
  if ! "${psql_cmd[@]}" -q -d "$db" -f "$archive_dir/readonly-sql/$filename"         > "$workdir/step-$version.log" 2>&1; then
    echo "FAIL: isolated chronological SQL replay at version $version, after $success successful original bodies" >&2
    tail -n 18 "$workdir/step-$version.log" >&2
    exit 1
  fi
  success=$((success+1))
  echo "PG17 isolated chronological replay PASS $success/99 version $version"
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
echo 'PASS: first 99/99 authentic migrations applied in order on disposable PG17, 8 tables and 4 RLS guards verified; physical checks do not certify Supabase Auth/Storage; #104 still NO-GO; #104 NO-GO'
