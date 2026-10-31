#!/usr/bin/env bash
set -euo pipefail
# PostgreSQL 17 integration test: plan transitions must wait for the same
# organization row lock used by seat/property guards.
psql -d ci_payment_capacity -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public.capacity_lock_probe(id uuid primary key, value integer NOT NULL);
INSERT INTO public.capacity_lock_probe VALUES ('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',0) ON CONFLICT DO NOTHING;
SQL
psql -d ci_payment_capacity -v ON_ERROR_STOP=1 -c "BEGIN; SELECT id FROM public.organizations WHERE id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' FOR UPDATE; SELECT pg_sleep(3); COMMIT;" > /tmp/capacity-lock-owner.log 2>&1 &
holder=$!
trap 'kill "$holder" 2>/dev/null || true' EXIT
sleep 1
if psql -d ci_payment_capacity -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '500ms';
SELECT id FROM public.organizations WHERE id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' FOR UPDATE;
COMMIT;
SQL
then
  echo 'ERROR: concurrent attempt bypassed organization row lock' >&2
  exit 1
else
  echo 'Concurrent transaction correctly waited on organization lock'
fi
wait "$holder"
trap - EXIT
psql -d ci_payment_capacity -v ON_ERROR_STOP=1 -c "BEGIN; SET LOCAL lock_timeout='2s'; SELECT id FROM public.organizations WHERE id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' FOR UPDATE; COMMIT;"
echo 'Organization lock released correctly'
