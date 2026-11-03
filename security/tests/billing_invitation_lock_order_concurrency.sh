#!/usr/bin/env bash
# PRODUCTION REFUSAL: this test only works on a throwaway GitHub PostgreSQL DB.
set -euo pipefail
db="${1:-}"
if [[ "$db" != "jco_invitation_lock_order_test" ]]; then
  echo "Refusing any database other than jco_invitation_lock_order_test" >&2
  exit 2
fi
pg=(psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d "$db")
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
user_id='99999999-aaaa-4aaa-8aaa-999999999999'
inv_id='11111111-0000-4000-8000-000000000111'
wait_for() {
  local q="$1" n
  for n in $(seq 1 100); do
    if [[ "$("${pg[@]}" -At -c "$q")" =~ ^[1-9] ]]; then return 0; fi
    sleep 0.04
  done
  echo "Timed out waiting for concurrency checkpoint: $q" >&2
  return 1
}
race() {
  local mode="$1" pid_b pid_a code_a=0 code_b=0
  # A privileged agency invitation editor can begin with the transaction
  # billing lock (for instance after membership/role changes), then edit an
  # invitation. It must not deadlock with a parallel invited-user claim.
  "${pg[@]}" -c "BEGIN;
    SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('inmojco.billing.authorization'),0);
    SELECT pg_catalog.pg_sleep(2.2);
    UPDATE public.organization_invitations SET status=status
     WHERE id='$inv_id'::uuid;
    COMMIT;" >"$workdir/$mode.admin.out" 2>"$workdir/$mode.admin.err" &
  pid_b=$!
  wait_for "SELECT COUNT(*) FROM pg_stat_activity
    WHERE datname=current_database() AND wait_event='PgSleep'
      AND query LIKE '%organization_invitations SET status=status%'
      AND pid<>pg_backend_pid()"
  "${pg[@]}" -c "BEGIN; SET LOCAL ROLE authenticated;
    SELECT pg_catalog.set_config('request.jwt.claim.sub','$user_id',true);
    SELECT public.claim_my_invitations();
    COMMIT;" >"$workdir/$mode.claim.out" 2>"$workdir/$mode.claim.err" &
  pid_a=$!
  # Both versions must reach the advisory lock. In the legacy version this
  # happens AFTER invitation FOR UPDATE, causing inverse lock acquisition.
  wait_for "SELECT COUNT(*) FROM pg_stat_activity
    WHERE datname=current_database() AND wait_event='advisory'
      AND query LIKE '%claim_my_invitations%'
      AND pid<>pg_backend_pid()" || {
    kill "$pid_a" "$pid_b" 2>/dev/null || true
    wait "$pid_a" || true
    wait "$pid_b" || true
    return 1
  }
  wait "$pid_a" || code_a=$?
  wait "$pid_b" || code_b=$?
  printf '%s %s' "$code_a" "$code_b"
}
status="$(race legacy)"
read -r a b <<<"$status"
if [[ "$a" == 0 && "$b" == 0 ]] ||
  ! grep -qi 'deadlock detected' "$workdir/legacy.claim.err" "$workdir/legacy.admin.err"; then
  echo "Expected 40P01 invitation/advisory cycle NOT reproduced: $status" >&2
  cat "$workdir"/legacy.*.err >&2
  exit 1
fi
echo "PASS: historical invitation-row-first path reproduces 40P01 in isolated DB"

# Restore ONLY fake invited-user rows before upgrade. Depending on deadlock
# victim the first invocation may have accepted one or both invitations.
"${pg[@]}" -c "
  DELETE FROM public.member_roles mr USING public.organization_members m
   WHERE mr.organization_member_id=m.id AND m.user_id='$user_id'::uuid;
  DELETE FROM public.organization_members WHERE user_id='$user_id'::uuid;
  UPDATE public.organization_invitations SET status='PENDING',
    accepted_at=NULL,accepted_by=NULL
   WHERE email='invited@example.test';" >"$workdir/reset.out"
"${pg[@]}" -f security/candidates/claim_my_invitations_billing_lock.sql >"$workdir/upgrade.out" 2>"$workdir/upgrade.err" || {
  cat "$workdir/upgrade.err" >&2
  exit 1
}
status="$(race guarded)"
read -r a b <<<"$status"
if [[ "$a" != 0 || "$b" != 0 ]]; then
  echo "Guarded invitation claim must serialize without deadlock: $status" >&2
  cat "$workdir"/guarded.*.err >&2
  exit 1
fi

# An unconfirmed email cannot claim any invitation; an accepted invitation
# cannot create a second membership or consume a second staff seat.
"${pg[@]}" -c "BEGIN; SET LOCAL ROLE authenticated;
  SELECT pg_catalog.set_config('request.jwt.claim.sub',
    '99999999-bbbb-4bbb-8bbb-999999999999',true);
  SELECT public.claim_my_invitations(); COMMIT;
  BEGIN; SET LOCAL ROLE authenticated;
  SELECT pg_catalog.set_config('request.jwt.claim.sub','$user_id',true);
  SELECT public.claim_my_invitations(); COMMIT;" >"$workdir/repeat.out"
stats="$("${pg[@]}" -At -F ',' -c "
 SELECT
 (SELECT count(*) FROM public.organization_members WHERE user_id='$user_id'::uuid),
 (SELECT count(*) FROM public.member_roles mr
   JOIN public.organization_members m ON m.id=mr.organization_member_id
   WHERE m.user_id='$user_id'::uuid),
 (SELECT count(*) FROM public.organization_invitations
   WHERE email='invited@example.test' AND status='ACCEPTED'
     AND accepted_by='$user_id'::uuid),
 (SELECT count(*) FROM public.organization_invitations
   WHERE email='invited@example.test' AND status='PENDING'),
 (SELECT count(*) FROM public.organization_members m
   JOIN public.member_roles mr ON mr.organization_member_id=m.id
   JOIN public.roles r ON r.id=mr.role_id
   WHERE m.user_id='$user_id'::uuid AND m.organization_id<>r.organization_id),
 (SELECT count(*) FROM public.organization_members
   WHERE user_id='99999999-bbbb-4bbb-8bbb-999999999999'::uuid),
 (SELECT count(*) FROM public.payment_orders);")"
if [[ "$stats" != "2,2,2,1,0,0,0" ]]; then
  echo "Unexpected roles/tenant/seats/claims/payment after concurrent claim: $stats" >&2
  exit 1
fi
"${pg[@]}" -c "DO \$\$ DECLARE src text; BEGIN
 SELECT prosrc INTO src FROM pg_proc
 WHERE oid='public.claim_my_invitations()'::regprocedure;
 IF strpos(src,'pg_advisory_xact_lock')=0 OR
    strpos(src,'pg_advisory_xact_lock')>strpos(src,'FOR UPDATE OF i') THEN
  RAISE EXCEPTION 'Advisory lock must precede invitation row lock';
 END IF;
 END \$\$;" >"$workdir/source.out"
echo "PASS: no deadlock; 2 agency-scoped invitations accepted once; inactive role ignored; 0 duplicate members, 0 orders"
