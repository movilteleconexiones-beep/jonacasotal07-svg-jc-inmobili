#!/usr/bin/env bash
set -euo pipefail
# Synthetic JCO/agency-B PostgreSQL 17 fixture ONLY. NEVER run against production.
# CI creates the disposable database before loading real rental migration SQL.
export PGHOST=localhost PGUSER=postgres PGDATABASE=jco_rental_draft_safety_test PGPASSWORD=postgres
psql_ci() { psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -At "$@"; }
[[ "$(psql_ci -c 'SELECT current_database()')" == "jco_rental_draft_safety_test" ]] || {
  echo 'REFUSED: requires synthetic CI database' >&2; exit 2;
}
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
org_a='11111111-1111-4111-8111-111111111111'
org_b='22222222-2222-4222-8222-222222222222'
property_a='10101010-1010-4010-8010-101010101010'
lease_with_pdf='60606060-6060-4060-8060-606060606060'
pdf_insert() {
  local file_id="$1" pdf="$2"
  printf "INSERT INTO public.documents(id,organization_id,entity_type,entity_id,document_type,storage_bucket,storage_path) VALUES ('%s','%s','GENERAL','%s','CONTRACT','organization-documents','%s/leases/%s/signed/%s.pdf');" \
    "$file_id" "$org_a" "$lease_with_pdf" "$org_a" "$lease_with_pdf" "$pdf"
}
lease_insert() {
  local id="$1"
  printf "INSERT INTO public.leases(id,organization_id,property_id,status,monthly_rent,start_date) VALUES ('%s','%s','%s','DRAFT',1700000,'2026-11-02');" "$id" "$org_a" "$property_a"
}
race() {
  local label="$1" first_query="$2" second_query="$3"
  local first_status=0 second_status=0
  psql_ci -c "BEGIN; $first_query SELECT pg_sleep(0.75); COMMIT;" >"$tmp/$label-a.log" 2>&1 &
  local first_pid=$!
  sleep 0.15
  psql_ci -c "$second_query" >"$tmp/$label-b.log" 2>&1 &
  local second_pid=$!
  wait "$first_pid" || first_status=$?
  wait "$second_pid" || second_status=$?
  if [[ "$first_status" == "$second_status" ]]; then
    echo "FAIL $label: expected exactly one success and one rejection" >&2
    cat "$tmp/$label-a.log" "$tmp/$label-b.log" >&2
    exit 1
  fi
  local rejected="$tmp/$label-b.log"
  if [[ "$first_status" -ne 0 ]]; then rejected="$tmp/$label-a.log"; fi
  if ! grep -q '23505' "$rejected"; then
    echo "FAIL $label: expected unique conflict SQLSTATE 23505" >&2
    cat "$rejected" >&2; exit 1
  fi
}
# Existing fixture draft persists; earlier assertions rollback their DML.
psql_ci -c "UPDATE public.leases SET status='CANCELLED' WHERE id='$lease_with_pdf' AND status='DRAFT';" >/dev/null
[[ "$(psql_ci -c "SELECT count(*) FROM public.leases WHERE organization_id='$org_a' AND property_id='$property_a' AND status IN ('DRAFT','ACTIVE','RENEWAL')")" == 0 ]] || exit 1

for round in 1 2 3; do
  n1="$(printf '%012d' "$((round * 2 + 100))")"
  n2="$(printf '%012d' "$((round * 2 + 101))")"
  lease_a="88888888-8888-4888-8888-$n1"
  lease_b="88888888-8888-4888-8888-$n2"
  race "lease-$round" "$(lease_insert "$lease_a")" "$(lease_insert "$lease_b")"
  [[ "$(psql_ci -c "SELECT count(*) FROM public.leases WHERE organization_id='$org_a' AND property_id='$property_a' AND status='DRAFT'")" == 1 ]] || {
    echo "FAIL lease-$round: double contract created" >&2; exit 1;
  }
  psql_ci -c "UPDATE public.leases SET status='CANCELLED' WHERE organization_id='$org_a' AND property_id='$property_a' AND status='DRAFT';" >/dev/null
  doc_a="99999999-9999-4999-8999-$n1"
  doc_b="99999999-9999-4999-8999-$n2"
  race "signed-pdf-$round" "$(pdf_insert "$doc_a" "test-a-$round")" "$(pdf_insert "$doc_b" "test-b-$round")"
  [[ "$(psql_ci -c "SELECT count(*) FROM public.documents WHERE organization_id='$org_a' AND entity_id='$lease_with_pdf' AND document_type='CONTRACT'")" == 1 ]] || {
    echo "FAIL signed-pdf-$round: duplicate signed PDF accepted" >&2; exit 1;
  }
  # Remove synthetic metadata only within the disposable database.
  psql_ci -c "DELETE FROM public.documents WHERE organization_id='$org_a' AND entity_id='$lease_with_pdf' AND document_type='CONTRACT';" >/dev/null
done

psql_ci -c "INSERT INTO public.leases(id,organization_id,property_id,status,monthly_rent,start_date) VALUES ('77777777-7777-4777-8777-777777777777','$org_b','20202020-2020-4020-8020-202020202020','DRAFT',900000,'2026-11-02');" >/dev/null
[[ "$(psql_ci -c "SELECT count(*) FROM public.leases WHERE organization_id='$org_b' AND status='DRAFT'")" == 1 ]] || exit 1
[[ "$(psql_ci -c "SELECT count(*) FROM public.documents")" == 0 ]] || exit 1
echo 'PASS: 3 contract races, 3 signed-PDF races, no duplicates, independent agency preserved'
