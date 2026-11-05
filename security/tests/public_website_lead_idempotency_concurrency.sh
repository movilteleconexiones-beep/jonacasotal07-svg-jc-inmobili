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
