#!/usr/bin/env bash
# Runs only against a self-created, disposable local PostgreSQL 17 database.
# No SQL writes are made against customer or production databases.
set -euo pipefail
db='jco_owner_deduction_storage_audit_test'
pg=(psql -v ON_ERROR_STOP=1 -h localhost -U postgres)
if [[ "${PGHOST:-}" != '' && "${PGHOST:-}" != 'localhost' ]]; then
  echo 'Refusing remote PGHOST for a local-only test fixture' >&2; exit 2
fi
if [[ "${PGPORT:-5432}" != '5432' ]]; then
  echo 'Refusing non-local test PostgreSQL port' >&2; exit 2
fi
if [[ "${PGUSER:-postgres}" != 'postgres' ]]; then
  echo 'Refusing non-fixture database role' >&2; exit 2
fi
if [[ "$("${pg[@]}" -d postgres -Atqc "SELECT current_database()")" != postgres ]]; then
  echo 'Unexpected PostgreSQL maintenance database' >&2; exit 2
fi
cleanup() {
  status=$?
  trap - EXIT
  "${pg[@]}" -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null || status=1
  exit "$status"
}
trap cleanup EXIT
"${pg[@]}" -d postgres -c "CREATE DATABASE $db" >/dev/null
sql='security/checks/owner_deduction_storage_consistency.sql'
fixture='security/tests/owner_deduction_storage_audit_fixture.sql'
# Assert the report is read-only even on an empty schema.
"${pg[@]}" -d "$db" -c 'CREATE SCHEMA storage; CREATE TABLE storage.objects(bucket_id text,name text); CREATE TABLE public.documents(organization_id uuid,entity_id uuid,entity_type text,document_type text,storage_bucket text,storage_path text,uploaded_by uuid);' >/dev/null
empty="$("${pg[@]}" -d "$db" -A -t -F ',' -f "$sql")"
[[ "$empty" == '0,0,0,0,0,0,0' ]] || { echo "Unexpected zero-data check: $empty" >&2; exit 1; }
# Reset only the disposable test database, never any other database.
"${pg[@]}" -d postgres -c "DROP DATABASE $db WITH (FORCE)" >/dev/null
"${pg[@]}" -d postgres -c "CREATE DATABASE $db" >/dev/null
"${pg[@]}" -d "$db" -f "$fixture" >/dev/null
actual="$("${pg[@]}" -d "$db" -A -t -F ',' -f "$sql")"
expected='5,5,3,1,1,1,1'
if [[ "$actual" != "$expected" ]]; then
  echo "Storage integrity aggregate mismatch: expected $expected but found $actual" >&2
  exit 1
fi
# Ensure the reporting query did not delete, rewrite, or generate private objects.
count_after="$("${pg[@]}" -d "$db" -Atqc 'SELECT count(*) FROM storage.objects')"
docs_after="$("${pg[@]}" -d "$db" -Atqc 'SELECT count(*) FROM public.documents')"
[[ "$count_after" == '5' && "$docs_after" == '5' ]] || {
  echo 'Read-only integrity check unexpectedly changed synthetic records' >&2; exit 1;
}
echo 'PASS: owner deduction Storage audit detects orphan=3 missing=1 mismatched=1 duplicate=1 malformed=1'
