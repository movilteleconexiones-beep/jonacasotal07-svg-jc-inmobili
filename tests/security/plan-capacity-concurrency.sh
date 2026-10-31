#!/usr/bin/env bash
set -euo pipefail
# Real PostgreSQL 17 race: concurrent seat insertion commits while the
# downgrade transaction is waiting for the organization's row lock.
org='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
basic='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
member='11111111-1111-4111-8111-111111111111'

psql -d ci_payment_capacity -v ON_ERROR_STOP=1 <<SQL > /tmp/capacity-writer.log 2>&1 &
BEGIN;
SELECT id FROM public.organizations WHERE id='$org' FOR UPDATE;
INSERT INTO public.organization_members(id,organization_id,status,external_only)
VALUES ('$member','$org','ACTIVE',false);
SELECT pg_sleep(3);
COMMIT;
SQL
writer=$!
trap 'kill "$writer" 2>/dev/null || true' EXIT
sleep 1

# Must not read the old 5-seat count while another transaction owns the row.
if psql -d ci_payment_capacity -v ON_ERROR_STOP=1 <<SQL > /tmp/capacity-blocked.log 2>&1
BEGIN;
SET LOCAL lock_timeout='500ms';
SELECT id FROM public.organizations WHERE id='$org' FOR UPDATE;
COMMIT;
SQL
then
  echo 'ERROR: concurrent transaction bypassed the organization row lock' >&2
  exit 1
fi

wait "$writer"
trap - EXIT

# Downgrade now observes the committed sixth operational seat.
result="$(psql -d ci_payment_capacity -At -v ON_ERROR_STOP=1 <<SQL
BEGIN;
SELECT id FROM public.organizations WHERE id='$org' FOR UPDATE;
SELECT jco_private.plan_capacity_fits('$org'::uuid,'$basic'::uuid);
COMMIT;
SQL
)"
if ! grep -qx 'f' <<< "$result"; then
  echo "ERROR: downgrade allowed despite committed sixth seat: $result" >&2
  exit 1
fi
echo 'PostgreSQL row lock + fresh capacity read correctly deny an incompatible downgrade'
