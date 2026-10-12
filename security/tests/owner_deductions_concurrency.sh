#!/usr/bin/env bash
set -euo pipefail

# Independent PostgreSQL 17 CI database; NEVER uses Supabase production.
export PGPASSWORD=postgres
psql_test() { psql -h localhost -U postgres -d jco_owner_deductions_test -v ON_ERROR_STOP=1 "$@"; }

hold_log="$(mktemp)"
cleanup() { rm -f "$hold_log"; }
trap cleanup EXIT

# Session A takes the parent row lock, then holds its transaction open.
(
  PGAPPNAME=jco_hold_deduction
  export PGAPPNAME
  psql_test -c "SET ROLE authenticated" \
    -c "SET jco_test.actor = '99999999-9999-4999-8999-999999999999'" \
    -c "SET jco_test.organization = '11111111-1111-4111-8111-111111111111'" \
    -c "BEGIN" \
    -c "INSERT INTO public.owner_statement_deductions
      (id,organization_id,statement_id,charge_date,category,responsible_party,amount,description)
      VALUES ('77777777-7777-4777-8777-777777777777',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '2026-10-01','OTHER','OWNER',12000,'Gasto concurrente autorizado')" \
    -c "SELECT pg_sleep(4)" \
    -c "COMMIT" >"$hold_log" 2>&1
) &
holder=$!

ready=0
for _ in $(seq 1 80); do
  if ! kill -0 "$holder" 2>/dev/null; then
    cat "$hold_log" >&2
    echo "FAIL: deduction transaction terminated before locking" >&2
    exit 1
  fi
  current="$(psql_test -At -c "SELECT count(*) FROM pg_stat_activity
    WHERE application_name='jco_hold_deduction' AND state='active'
      AND query LIKE 'SELECT pg_sleep%'")"
  if [ "$current" = "1" ]; then ready=1; break; fi
  sleep 0.1
done
if [ "$ready" -ne 1 ]; then
  cat "$hold_log" >&2
  echo "FAIL: deduction transaction never reached locked hold" >&2
  kill "$holder" 2>/dev/null || true
  exit 1
fi

# Session B must wait before closing the parent statement.
start_ms="$(date +%s%3N)"
psql_test -c "UPDATE public.owner_statements SET status='GENERATED'
  WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'" >/dev/null
elapsed_ms=$(( $(date +%s%3N) - start_ms ))
wait "$holder"

if [ "$elapsed_ms" -lt 1500 ]; then
  echo "FAIL: statement close was not serialized with deduction ($elapsed_ms ms)" >&2
  exit 1
fi
result="$(psql_test -At -c "
  SELECT (SELECT status FROM public.owner_statements
    WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  || ':' ||
  (SELECT count(*) FROM public.owner_statement_deductions
    WHERE id='77777777-7777-4777-8777-777777777777')")"
if [ "$result" != "GENERATED:1" ]; then
  echo "FAIL: concurrent change damaged statement or deduction: $result" >&2
  exit 1
fi
echo "PASS: closing a statement waited $elapsed_ms ms for the deduction transaction"
