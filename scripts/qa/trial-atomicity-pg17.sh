#!/usr/bin/env bash
# Disposable CI PostgreSQL only. No hosted DB, credentials or real customer data.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]]
[[ "${PGHOST:-}" == 127.0.0.1 && "${PGDATABASE:-}" == jco_trial_atomicity ]]
sql() { psql -X -v ON_ERROR_STOP=1 "$@"; }
tmp="$(mktemp -d)"
first=""
second=""
cleanup() {
  if [[ -n "$first" ]]; then kill "$first" 2>/dev/null || true; fi
  if [[ -n "$second" ]]; then kill "$second" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT
sql <<'SQL'
CREATE TABLE public.audit_log(actor_user_id uuid, action text NOT NULL);
CREATE TABLE public.qa_trial(organization_id int PRIMARY KEY, actor_user_id uuid NOT NULL);
SQL
sql -f docs/ops/pending-sql/g203_one_trial_per_owner.sql
# Each transaction creates a synthetic trial before recording its audit event,
# matching the real RPC's atomic ordering. The winner holds the unique key.
PGAPPNAME=qa-trial-winner sql >"$tmp/winner" 2>&1 <<'SQL' &
BEGIN;
INSERT INTO public.qa_trial VALUES(1,'00000000-0000-4000-8000-000000000001');
INSERT INTO public.audit_log VALUES('00000000-0000-4000-8000-000000000001','billing.trial_started');
SELECT pg_sleep(8);
COMMIT;
SQL
first=$!
ready=0
for i in $(seq 1 60); do
  if [[ "$(sql -Atc "select count(*) from pg_stat_activity where application_name='qa-trial-winner' and wait_event='PgSleep'")" == 1 ]]; then ready=1; break; fi
  sleep 0.1
done
[[ "$ready" == 1 ]]
PGAPPNAME=qa-trial-loser sql --set=VERBOSITY=verbose >"$tmp/loser" 2>&1 <<'SQL' &
BEGIN;
INSERT INTO public.qa_trial VALUES(2,'00000000-0000-4000-8000-000000000001');
INSERT INTO public.audit_log VALUES('00000000-0000-4000-8000-000000000001','billing.trial_started');
COMMIT;
SQL
second=$!
blocked=0
for i in $(seq 1 60); do
  if [[ "$(sql -Atc "select count(*) from pg_stat_activity where application_name='qa-trial-loser' and wait_event_type='Lock'")" == 1 ]]; then blocked=1; break; fi
  sleep 0.1
done
[[ "$blocked" == 1 ]]
wait "$first"; first=""
set +e
wait "$second"
status=$?
set -e
second=""
[[ "$status" != 0 ]]
grep -q '23505' "$tmp/loser"
[[ "$(sql -Atc 'select count(*) from public.qa_trial')" == 1 ]]
[[ "$(sql -Atc 'select organization_id from public.qa_trial')" == 1 ]]
[[ "$(sql -Atc "select count(*) from public.audit_log where action='billing.trial_started'")" == 1 ]]
sql <<'SQL'
INSERT INTO public.qa_trial VALUES(3,'00000000-0000-4000-8000-000000000002');
INSERT INTO public.audit_log VALUES('00000000-0000-4000-8000-000000000002','billing.trial_started');
INSERT INTO public.audit_log VALUES
 ('00000000-0000-4000-8000-000000000001','qa.other'),
 ('00000000-0000-4000-8000-000000000001','qa.other');
SQL
[[ "$(sql -Atc 'select count(*) from public.qa_trial')" == 2 ]]
[[ "$(sql -Atc "select count(*) from public.audit_log where action='qa.other'")" == 2 ]]
echo 'PASS: genuine concurrent lock; SQLSTATE 23505; losing trial fully rolled back; other actor and audit actions unaffected.'
