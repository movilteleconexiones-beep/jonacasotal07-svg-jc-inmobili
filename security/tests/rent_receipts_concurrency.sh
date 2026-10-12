#!/usr/bin/env bash
set -euo pipefail
# Only the disposable PostgreSQL 17 CI database, never a production project.
export PGPASSWORD=postgres
psql_test() { psql -X -h localhost -U postgres -d jco_rent_entries_test -v ON_ERROR_STOP=1 "$@"; }
actor="SET ROLE authenticated; SET jco_test.actor='99999999-9999-4999-8999-999999999999'; SET jco_test.organization='11111111-1111-4111-8111-111111111111';"
period="(SELECT id FROM public.rent_payments WHERE organization_id='11111111-1111-4111-8111-111111111111' AND lease_id='33333333-3333-4333-8333-333333333333' AND period_month='2026-12-01')"
logs="$(mktemp -d)"
trap 'rm -rf "$logs"' EXIT
psql_test -c "$actor SELECT public.create_tenant_rent_period('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','2026-12-01');" >/dev/null
duplicate="SELECT public.record_tenant_rent_receipt('11111111-1111-4111-8111-111111111111',$period,100000,'CASH','CONCURRENT-SAME-RECEIPT','12121212-3434-4567-8901-121212121212');"
psql_test -c "$actor BEGIN; $duplicate SELECT pg_sleep(2); COMMIT;" >"$logs/first" 2>&1 &
first=$!
psql_test -c "$actor $duplicate" >"$logs/second" 2>&1 &
second=$!
wait "$first"
wait "$second"
psql_test -c "DO \$check\$ BEGIN
 IF (SELECT paid_amount FROM public.rent_payments WHERE id=$period)<>100000 OR
    (SELECT count(*) FROM public.rent_receipts WHERE rent_payment_id=$period)<>1 THEN
  RAISE EXCEPTION 'Concurrent duplicate request was credited twice'; END IF;
 END \$check\$;" >/dev/null

# Two competing receipts would jointly exceed the debt: exactly one succeeds.
psql_test -c "$actor SELECT public.record_tenant_rent_receipt('11111111-1111-4111-8111-111111111111',$period,1000000,'CASH','CONCURRENT-RECEIPT-A','23232323-3434-4567-8901-232323232323');" >"$logs/a" 2>&1 &
first=$!
psql_test -c "$actor SELECT public.record_tenant_rent_receipt('11111111-1111-4111-8111-111111111111',$period,1000000,'CASH','CONCURRENT-RECEIPT-B','34343434-3434-4567-8901-343434343434');" >"$logs/b" 2>&1 &
second=$!
result_a=0; result_b=0
wait "$first" || result_a=$?
wait "$second" || result_b=$?
if { [ "$result_a" = 0 ] && [ "$result_b" = 0 ]; } || { [ "$result_a" != 0 ] && [ "$result_b" != 0 ]; }; then
 cat "$logs/a" "$logs/b" >&2
 exit 1
fi
if [ "$result_a" != 0 ]; then rejection="$logs/a"; else rejection="$logs/b"; fi
if ! rg -q 'Receipt exceeds the recorded pending amount' "$rejection"; then
 cat "$rejection" >&2
 exit 1
fi
psql_test -c "DO \$check\$ BEGIN
 IF (SELECT paid_amount FROM public.rent_payments WHERE id=$period)<>1100000 OR
    (SELECT count(*) FROM public.rent_receipts WHERE rent_payment_id=$period)<>2 THEN
  RAISE EXCEPTION 'Concurrent excess receipt changed the accounting ledger'; END IF;
 END \$check\$;" >/dev/null
echo 'PASS: concurrent receipts preserve idempotency and cannot exceed pending rent'
