#!/usr/bin/env bash
# ONLY disposable GitHub Actions PostgreSQL 17, no production connections.
set -euo pipefail
db="${1:-}"
if [[ "$db" != "jco_contact_identity_test" ]]; then
  echo "Refusing non-fixture database" >&2
  exit 2
fi
pg=(psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d "$db")
if [[ "$("${pg[@]}" -Atqc "SELECT current_database()")" != "$db" ]]; then
  echo "Unexpected SQL database" >&2
  exit 2
fi
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
org='11111111-1111-4111-8111-111111111111'
sql="SET ROLE authenticated;
  SET app.tenant_id='$org';
  INSERT INTO public.contacts(organization_id,first_name,last_name,email)
  VALUES('$org'::uuid,'Prueba','Paralela','parallel@example.test') RETURNING id;"
pids=()
for worker in 1 2 3 4; do
  "${pg[@]}" -c "$sql" >"$workdir/$worker.out" 2>"$workdir/$worker.err" &
  pids+=("$!")
done
success=0
rejected=0
for i in 0 1 2 3; do
  w=$((i+1))
  if wait "${pids[$i]}"; then
    success=$((success+1))
  elif grep -q 'duplicate key value violates unique constraint "jco_contacts_tenant_email_name_unique"' "$workdir/$w.err"; then
    rejected=$((rejected+1))
  else
    echo "Unexpected concurrent contact INSERT failure" >&2
    sed -E 's/\(organization_id[^)]*\)=\([^)]*\)/[REDACTED]/g' "$workdir/$w.err" >&2
    exit 1
  fi
done
actual="$("${pg[@]}" -Atqc "
 SELECT COUNT(*) FROM public.contacts
 WHERE organization_id='$org'::uuid AND lower(btrim(email))='parallel@example.test'
   AND lower(btrim(first_name || ' ' || coalesce(last_name,'')))='prueba paralela';")"
if [[ "$success" -ne 1 || "$rejected" -ne 3 || "$actual" != "1" ]]; then
  echo "Duplicate acceptance/rejection ratio incorrect: accepted=$success rejected=$rejected rows=$actual" >&2
  exit 1
fi
echo "PASS: four concurrent authenticated staff INSERTs yield one contact and three 23505 conflicts"
