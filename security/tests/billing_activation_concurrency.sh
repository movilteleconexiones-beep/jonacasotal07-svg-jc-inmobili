#!/usr/bin/env bash
set -euo pipefail
task_db="${JCO_BILLING_TEST_DB:-jco_activation_test}"
task_output=$(mktemp -d)
trap 'rm -rf "$task_output"' EXIT
task_sql="SELECT set_config('request.jwt.claim.role','service_role',false);
SELECT public.process_verified_payment_event((SELECT reference FROM public.payment_orders WHERE idempotency_key='50000000-0000-0000-0000-000000000005'),'tx-concurrent',19490000,'COP','APPROVED','sandbox',repeat('6',64),repeat('7',64));"
psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d "$task_db" -Atc "$task_sql" >"$task_output/one" &
task_one=$!
psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d "$task_db" -Atc "$task_sql" >"$task_output/two" &
task_two=$!
wait "$task_one"
wait "$task_two"
psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d "$task_db" <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.payment_events WHERE provider_event_id=repeat('6',64))<>1
 OR (SELECT count(*) FROM public.subscriptions WHERE organization_id='20000000-0000-0000-0000-000000000005')<>1
 OR (SELECT count(*) FROM public.audit_log WHERE organization_id='20000000-0000-0000-0000-000000000005' AND action='billing.payment_activated')<>1
 THEN RAISE EXCEPTION 'Concurrent webhook duplicated activation'; END IF;
END $$;
SQL
echo 'PASS concurrent delivery activated exactly once'
