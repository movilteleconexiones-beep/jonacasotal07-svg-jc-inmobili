#!/usr/bin/env bash
set -euo pipefail
# Synthetic JCO owner-payment PostgreSQL 17 tests ONLY. No transfers, no external API.
# Run after owner_payout_end_to_end_fixture.sql + real payout migration + rolled-back assertions.
export PGHOST=localhost PGUSER=postgres PGDATABASE=jco_owner_payout_e2e_test PGPASSWORD=postgres
psql_ci() { psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -At "$@"; }
[[ "$(psql_ci -c 'SELECT current_database()')" == 'jco_owner_payout_e2e_test' ]] || {
  echo 'REFUSED: owner payment race requires isolated CI test database' >&2; exit 2;
}
org_a='11111111-1111-4111-8111-111111111111'
org_b='22222222-2222-4222-8222-222222222222'
stmt_a='44444444-4444-4444-8444-444444444444'
stmt_b='55555555-5555-4555-8555-555555555555'
manager_a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
manager_b='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# One RPC call in one session. SET ROLE and JWT test claim are scoped
# exclusively to the disposable PostgreSQL connection.
call_payout() {
  local org="$1" statement="$2" actor="$3" amount="$4" reference="$5"
  printf "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','%s',false); SELECT public.admin_record_owner_payout('%s','%s',%s,CURRENT_DATE,'TRANSFER','%s','owner-payouts/test-only-evidence.pdf');" \
    "$actor" "$statement" "$org" "$amount" "$reference"
}
race_payout() {
  local label="$1" sql_a="$2" sql_b="$3" rejection_sqlstate="$4"
  local code_a=0 code_b=0
  psql_ci -c "BEGIN; $sql_a SELECT pg_sleep(0.75); COMMIT;" >"$tmp/$label-first.log" 2>&1 &
  local first=$!
  sleep 0.15
  psql_ci -c "$sql_b" >"$tmp/$label-second.log" 2>&1 &
  local second=$!
  wait "$first" || code_a=$?
  wait "$second" || code_b=$?
  if [[ "$code_a" == "$code_b" ]]; then
    echo "FAIL $label: expected one accepted and one rejected payout" >&2
    cat "$tmp/$label-first.log" "$tmp/$label-second.log" >&2
    exit 1
  fi
  local rejected="$tmp/$label-second.log"
  [[ "$code_a" -ne 0 ]] && rejected="$tmp/$label-first.log"
  if ! grep -q "$rejection_sqlstate" "$rejected"; then
    echo "FAIL $label: expected SQLSTATE $rejection_sqlstate for rejected payout" >&2
    cat "$rejected" >&2
    exit 1
  fi
}

# No earlier payout assertions should have leaked through their ROLLBACK.
[[ "$(psql_ci -c "SELECT count(*) FROM public.owner_statement_payouts")" == 0 ]] || {
  echo 'FAIL: test fixture is not clean' >&2; exit 1;
}
# Same idempotency reference submitted concurrently: exactly one 390000 COP entry.
q1="$(call_payout "$org_a" "$stmt_a" "$manager_a" 390000 'SYNTH-PAYOUT-DUPLICATE')"
race_payout 'same-reference' "$q1" "$q1" 23505
[[ "$(psql_ci -c "SELECT count(*)::text||':'||sum(amount)::text FROM public.owner_statement_payouts WHERE organization_id='$org_a'")" == '1:390000.00' ]] || {
  echo 'FAIL: concurrent duplicate payout credited twice' >&2; exit 1;
}
# Two independent partial disbursements of 900000 COP compete for only
# 1000000 COP remaining. Exactly one must pass; the other must fail.
q2="$(call_payout "$org_a" "$stmt_a" "$manager_a" 900000 'SYNTH-PAYOUT-RACE-A')"
q3="$(call_payout "$org_a" "$stmt_a" "$manager_a" 900000 'SYNTH-PAYOUT-RACE-B')"
race_payout 'overspend' "$q2" "$q3" 23514
[[ "$(psql_ci -c "SELECT count(*)::text||':'||sum(amount)::text FROM public.owner_statement_payouts WHERE organization_id='$org_a'")" == '2:1290000.00' ]] || {
  echo 'FAIL: concurrent payouts exceeded the net authorized balance' >&2; exit 1;
}
[[ "$(psql_ci -c "SELECT status FROM public.owner_statements WHERE id='$stmt_a'")" == 'GENERATED' ]] || {
  echo 'FAIL: partial payout finalized the owner statement too early' >&2; exit 1;
}
# Final 100000 COP settles once, preserving the audit user for all entries.
psql_ci -c "$(call_payout "$org_a" "$stmt_a" "$manager_a" 100000 'SYNTH-PAYOUT-FINAL')" >/dev/null
[[ "$(psql_ci -c "SELECT count(*)::text||':'||sum(amount)::text FROM public.owner_statement_payouts WHERE organization_id='$org_a' AND recorded_by='$manager_a'")" == '3:1390000.00' ]] || exit 1
[[ "$(psql_ci -c "SELECT status FROM public.owner_statements WHERE id='$stmt_a'")" == 'PAID' ]] || exit 1
# Manager of an unrelated tenant can pay its own statement without changing A.
psql_ci -c "$(call_payout "$org_b" "$stmt_b" "$manager_b" 100000 'SYNTH-B-OWNER-PAYOUT')" >/dev/null
[[ "$(psql_ci -c "SELECT sum(amount)::text FROM public.owner_statement_payouts WHERE organization_id='$org_b'")" == '100000.00' ]] || exit 1
[[ "$(psql_ci -c "SELECT sum(amount)::text FROM public.owner_statement_payouts WHERE organization_id='$org_a'")" == '1390000.00' ]] || exit 1
echo 'PASS: concurrent duplicate reference, competing owner balances, exact settlement and cross-tenant independence'
