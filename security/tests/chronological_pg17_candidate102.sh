#!/usr/bin/env bash
# INMOJCO #325 — execute all 102 SQL files from the staging-only bundle,
# preserving the real 99-row history in a separate reference table.
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
candidate_dir=''
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
  if [[ -n "$candidate_dir" && "$candidate_dir" == /tmp/inmojco-staging325-NO-PROD-* ]]; then
    rm -rf -- "$candidate_dir" || code=1
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

# Materialize exactly 102 ordered SQL files in a fresh temporary directory.
# Every canonical source and the three staging candidates is SHA-verified.
node scripts/ops/staging325-build-bootstrap.mjs --temporary-staging-only > "$workdir/staging-candidate.json"
candidate_dir="$(node - "$workdir/staging-candidate.json" <<'JS'
const fs=require('node:fs');
const x=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!x.ok || x.canonical!==99 || x.stagingOnly!==3 || x.total!==102 ||
   x.safeForProduction!==false ||
   !x.temporaryDirectory?.startsWith('/tmp/inmojco-staging325-NO-PROD-'))
  process.exit(5);
process.stdout.write(x.temporaryDirectory);
JS
)"
mapfile -t candidates < <(node - "$candidate_dir/STAGING-ONLY-MANIFEST.json" <<'JS'
const fs=require('node:fs');
const m=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(m.safeForProduction!==false||m.doNotMergeWithProduction!==true||
   m.originalVersions!==99||m.stagingPrerequisites!==3||m.total!==102||
   m.files.length!==102)process.exit(6);
for(const row of m.files) {
 if(!/^[0-9]{14}_[a-z0-9_]+\.sql$/.test(row.name)||
    !['CANONICAL','STAGING_ONLY'].includes(row.kind))process.exit(7);
 console.log(row.version+'|'+row.kind+'|'+row.name);
}
JS
)
if [[ "${#candidates[@]}" != 102 ]]; then
  echo 'ERROR: staging bootstrap must contain precisely 102 pinned files' >&2
  exit 1
fi

# Supabase CLI normally maintains this metadata. Emulate ONLY the version
# column inside the disposable replay database, inserting after each success.
"${psql_cmd[@]}" -q -d "$db" -c 'CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
CREATE SCHEMA staging_candidate;
CREATE TABLE staging_candidate.replayed_versions(version text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN (''CANONICAL'',''STAGING_ONLY'')))' >/dev/null

success=0
for row in "${candidates[@]}"; do
  IFS='|' read -r version kind filename <<< "$row"
  if [[ ! "$version" =~ ^[0-9]{14}$ ||
        ! "$filename" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ||
        "$filename" != "$version"_* ||
        ( "$kind" != 'CANONICAL' && "$kind" != 'STAGING_ONLY' ) ]]; then
    echo 'ERROR: unreviewed historical file name' >&2
    exit 1
  fi
  # Negative control: the final canonical guard MUST fail without the
  # new branch-only service_role GRANT, before that candidate migration runs.
  if [[ "$version" == '20261031032349' ]]; then
    "${psql_cmd[@]}" -q -d "$db" -c \
      'REVOKE UPDATE ON TABLE public.organizations FROM service_role' \
      > "$workdir/candidate-revoke.log" 2>&1
    service_update="$("${psql_cmd[@]}" -qAt -d "$db" -c \
      "SELECT has_column_privilege('service_role','public.organizations','plan_id','UPDATE')")"
    [[ "$service_update" == 'f' ]] || { echo 'FAIL: missing negative branch ACL reproduction' >&2; exit 1; }
    last_file="$candidate_dir/supabase/migrations/20261031032350_restrict_organization_commercial_updates.sql"
    if "${psql_cmd[@]}" -q -d "$db" -f "$last_file" > "$workdir/expected-commercial-failure.log" 2>&1; then
      echo 'FAIL: historical service ACL guard passed without staging prerequisite' >&2
      exit 1
    fi
    grep -Fq 'Trusted billing service lost commercial update access' \
      "$workdir/expected-commercial-failure.log" || { echo 'FAIL: wrong ACL denial' >&2; exit 1; }
  fi
  # Fail at the exact version and stop. No production SQL has been invoked.
  if ! "${psql_cmd[@]}" -q -d "$db" -f "$candidate_dir/supabase/migrations/$filename" > "$workdir/step-$version.log" 2>&1; then
    echo "FAIL: isolated chronological SQL replay at version $version, after $success successful original bodies" >&2
    tail -n 18 "$workdir/step-$version.log" >&2
    exit 1
  fi
  success=$((success+1))
  "${psql_cmd[@]}" -q -d "$db" -c \
    "INSERT INTO staging_candidate.replayed_versions(version,kind) VALUES ('$version','$kind')" >/dev/null
  if [[ "$kind" == 'CANONICAL' ]]; then
    "${psql_cmd[@]}" -q -d "$db" -c \
      "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('$version')" >/dev/null
  fi
  echo "PG17 102-step staging-only candidate replay PASS $success/102 version $version $kind"
done

# Confirm the staging proposal contains 102 successful steps while the
# *authentic production* reference remains exactly 99 original versions.
counts="$("${psql_cmd[@]}" -qAt -d "$db" -c "
SELECT (SELECT count(*) FROM staging_candidate.replayed_versions),
       (SELECT count(*) FROM staging_candidate.replayed_versions WHERE kind='STAGING_ONLY'),
       (SELECT count(*) FROM supabase_migrations.schema_migrations)")"
if [[ "$counts" != '102|3|99' ]]; then
  echo "FAIL: 102/3/99 candidate/reference migration proof mismatch: $counts" >&2
  exit 1
fi

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
echo 'PASS: all 102 staging-only candidate SQL files replayed on disposable PG17 (99 canonical + 3 prerequisites); catalog 24/24; hosted Supabase bootstrap still NOT certified'
