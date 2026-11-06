#!/usr/bin/env bash
# Only the throwaway GitHub CI database is accepted. Never target production.
set -euo pipefail

# Fail before connecting if somebody invokes this synthetic-data writer outside
# the disposable GitHub CI job. Never write fixtures on a developer's database.
if [[ "${CI:-}" != "true" || "${GITHUB_ACTIONS:-}" != "true" || -z "${RUNNER_TEMP:-}" ]]; then
  echo "This concurrent CRM fixture is restricted to isolated GitHub Actions CI" >&2
  exit 2
fi

db="${1:-}"
if [[ "${db}" != "jco_public_lead_intake_test" ]]; then
  echo "This concurrency test only runs against jco_public_lead_intake_test" >&2
  exit 2
fi

request_id='99999999-0000-4000-8000-000000000019'
email='parallel-once@example.test'
sql="SET ROLE anon; SELECT public.submit_public_website_lead_once(
'alpha-agency','Concurrente Prueba','${email}',
'+57 300 123 4567','Administración','Una consulta',true,'',
'${request_id}'::uuid);"
logs_dir="$(mktemp -d)"
trap 'rm -rf "$logs_dir"' EXIT
pids=()
for n in 1 2 3 4; do
  psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d "$db" -c "$sql" >"$logs_dir/$n.out" 2>"$logs_dir/$n.err" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    echo "Concurrent public CRM submission failed" >&2
    exit 1
  fi
done

stats="$(psql -At -v ON_ERROR_STOP=1 -h localhost -U postgres -d "$db" -c "
SELECT (SELECT COUNT(*) FROM public.contacts WHERE email='${email}') || ',' ||
(SELECT COUNT(*) FROM public.leads l JOIN public.contacts c ON c.id=l.contact_id WHERE c.email='${email}') || ',' ||
(SELECT COUNT(*) FROM private.website_lead_consents WHERE request_id='${request_id}'::uuid);")"
if [[ "$stats" != "1,1,1" ]]; then
  echo "Concurrent retries must produce exactly one contact, lead and consent" >&2
  exit 1
fi
echo "PASS: four parallel clients replay one UUID without duplicate CRM rows"

# Separate legitimate requests must not be collapsed by the contact-reuse lock.
# Two independent UUIDs, each retried concurrently, must leave ONE tenant
# contact but TWO opportunities with their own immutable consent receipts.
distinct_email='parallel-distinct@example.test'
first_id='99999999-0000-4000-8000-000000000020'
second_id='99999999-0000-4000-8000-000000000021'
pids=()
for n in 1 2 3 4; do
  if [[ "$n" -le 2 ]]; then
    this_id="$first_id"
    this_message='Primera consulta legitima'
  else
    this_id="$second_id"
    this_message='Segunda consulta legitima'
  fi
  sql="SET ROLE anon; SELECT public.submit_public_website_lead_once(
'alpha-agency','Cliente Simultaneo','${distinct_email}',
'+57 300 123 4567','Ventas','${this_message}',true,'',
'${this_id}'::uuid);"
  psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d "$db" -c "$sql" >"$logs_dir/distinct-$n.out" 2>"$logs_dir/distinct-$n.err" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    echo "Distinct simultaneous public CRM requests failed" >&2
    cat "$logs_dir"/distinct-*.err >&2
    exit 1
  fi
done

distinct_stats="$(psql -At -v ON_ERROR_STOP=1 -h localhost -U postgres -d "$db" -c "
SELECT
  (SELECT COUNT(*) FROM public.contacts
    WHERE organization_id='00000000-0000-4000-8000-000000000001'::uuid
      AND email='${distinct_email}') || ',' ||
  (SELECT COUNT(*) FROM public.leads l JOIN public.contacts c ON c.id=l.contact_id
    WHERE l.organization_id='00000000-0000-4000-8000-000000000001'::uuid
      AND c.email='${distinct_email}') || ',' ||
  (SELECT COUNT(*) FROM private.website_lead_consents r
    JOIN public.contacts c ON c.id=r.contact_id
    WHERE r.organization_id='00000000-0000-4000-8000-000000000001'::uuid
      AND c.email='${distinct_email}'
      AND r.request_id IN ('${first_id}'::uuid,'${second_id}'::uuid)) || ',' ||
  (SELECT COUNT(DISTINCT r.request_id) FROM private.website_lead_consents r
    JOIN public.contacts c ON c.id=r.contact_id
    WHERE r.organization_id='00000000-0000-4000-8000-000000000001'::uuid
      AND c.email='${distinct_email}') || ',' ||
  (SELECT COUNT(*) FROM public.leads l JOIN public.contacts c ON c.id=l.contact_id
    WHERE c.email='${distinct_email}'
      AND (l.notes LIKE '%Primera consulta legitima%'
           OR l.notes LIKE '%Segunda consulta legitima%'));
")"
if [[ "$distinct_stats" != "1,2,2,2,2" ]]; then
  echo "Two distinct concurrent inquiries must preserve one contact, two leads and two consents (got $distinct_stats)" >&2
  exit 1
fi
echo "PASS: parallel distinct UUIDs preserve both inquiries and consent events without duplicating the contact"
