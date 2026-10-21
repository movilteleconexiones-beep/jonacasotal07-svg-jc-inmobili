#!/usr/bin/env bash
set -euo pipefail
task_test_dir=$(mktemp -d)
trap 'rm -rf "$task_test_dir"' EXIT
task_psql=(psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d jco_consignment_test)

"${task_psql[@]}" -q -c "UPDATE public.organizations SET status='ACTIVE' WHERE id='33333333-3333-3333-3333-333333333333'; UPDATE public.consignment_test_operational_access SET allowed=true WHERE organization_id='33333333-3333-3333-3333-333333333333'; UPDATE private.property_intake_sites SET hourly_limit=2 WHERE slug='disabled';"

task_submit() {
  "${task_psql[@]}" -q -c "BEGIN; SET LOCAL ROLE anon; SELECT public.submit_property_consignment('disabled','$1',public.consignment_test_payload() || '{\"owner_phone\":\"1234567\"}'::jsonb); SELECT pg_sleep(0.5); COMMIT;"
}

# Two concurrent retries must both receive the same receipt, with one insert.
task_submit '40000000-0000-0000-0000-000000000001' >"$task_test_dir/retry-a" 2>&1 &
task_pid_a=$!
task_submit '40000000-0000-0000-0000-000000000001' >"$task_test_dir/retry-b" 2>&1 &
task_pid_b=$!
wait "$task_pid_a"
wait "$task_pid_b"
"${task_psql[@]}" -q -c "SELECT public.consignment_test_assert((SELECT count(*)=1 FROM public.property_consignments WHERE organization_id='33333333-3333-3333-3333-333333333333'),'concurrent retry creates one row');"

# One quota slot remains: concurrent distinct requests cannot both consume it.
task_submit '40000000-0000-0000-0000-000000000002' >"$task_test_dir/quota-a" 2>&1 &
task_pid_a=$!
task_submit '40000000-0000-0000-0000-000000000003' >"$task_test_dir/quota-b" 2>&1 &
task_pid_b=$!
task_status_a=0
task_status_b=0
wait "$task_pid_a" || task_status_a=$?
wait "$task_pid_b" || task_status_b=$?
if ! { [[ "$task_status_a" == 0 && "$task_status_b" != 0 ]] || [[ "$task_status_a" != 0 && "$task_status_b" == 0 ]]; }; then
  cat "$task_test_dir/quota-a" "$task_test_dir/quota-b"
  exit 1
fi
grep -q 'intake_rate_limited' "$task_test_dir/quota-a" "$task_test_dir/quota-b"
"${task_psql[@]}" -q -c "SELECT public.consignment_test_assert((SELECT count(*)=2 FROM public.property_consignments WHERE organization_id='33333333-3333-3333-3333-333333333333'),'concurrent quota respected');"
echo 'Property consignment concurrency checks passed'

# Concurrent reviewer retries must create one property, contact and lead.
"${task_psql[@]}" -q -c "INSERT INTO public.consignment_test_permissions SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,'33333333-3333-3333-3333-333333333333'::uuid,p FROM unnest(ARRAY['properties.view','properties.create','properties.edit','clients.view','clients.create','leads.edit']) p;"
task_review_id=$("${task_psql[@]}" -At -c "SELECT id FROM public.property_consignments WHERE organization_id='33333333-3333-3333-3333-333333333333' AND request_id='40000000-0000-0000-0000-000000000001'")
[[ "$task_review_id" =~ ^[0-9a-f-]{36}$ ]]
task_review() {
  "${task_psql[@]}" -q -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true); SELECT public.review_property_consignment('$task_review_id','ACCEPTED','Concurrent test'); SELECT pg_sleep(0.5); COMMIT;"
}
task_review >"$task_test_dir/review-a" 2>&1 &
task_pid_a=$!
task_review >"$task_test_dir/review-b" 2>&1 &
task_pid_b=$!
wait "$task_pid_a"
wait "$task_pid_b"
"${task_psql[@]}" -q -c "SELECT public.consignment_test_assert((SELECT count(*)=1 FROM public.properties WHERE organization_id='33333333-3333-3333-3333-333333333333'),'concurrent review creates one property'); SELECT public.consignment_test_assert((SELECT count(*)=1 FROM public.contacts WHERE organization_id='33333333-3333-3333-3333-333333333333'),'concurrent review creates one contact'); SELECT public.consignment_test_assert((SELECT count(*)=1 FROM public.leads WHERE organization_id='33333333-3333-3333-3333-333333333333'),'concurrent review creates one opportunity');"
echo 'Property consignment reviewer concurrency checks passed'
