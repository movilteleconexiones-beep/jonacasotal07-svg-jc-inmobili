#!/usr/bin/env bash
# PostgreSQL 17 fixture ONLY. Never use against a real Supabase project.
set -euo pipefail
db="${1:-}"
if [[ "$db" != "jco_role_lock_order_test" ]]; then
  echo "Refusing anything outside the disposable jco_role_lock_order_test" >&2
  exit 2
fi
pg=(psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d "$db")
role_id='99999999-9999-4999-8999-999999999999'
org='11111111-1111-4111-8111-111111111111'
member_user='11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Discover application code reached the test-only sleep AFTER acquiring FOR UPDATE.
wait_for_editor_lock() {
  local observed='0'
  for i in $(seq 1 60); do
    observed="$("${pg[@]}" -At -c "SELECT COUNT(*) FROM pg_stat_activity
       WHERE datname=current_database() AND wait_event='PgSleep'
         AND query LIKE '%admin_update_role_permissions%'
         AND pid<>pg_backend_pid()")"
    if [[ "$observed" =~ ^[1-9] ]]; then return 0; fi
    sleep 0.04
  done
  echo "Role editor never reached instrumented post-row-lock stage" >&2
  return 1
}
run_race() {
  local mode="$1"
  local a_pid b_pid a_rc=0 b_rc=0
  local editor_sql="BEGIN; SET ROLE authenticated;
    SET request.jwt.claim.sub='$member_user';
    SET app.simulate_role_lock_delay='yes';
    SELECT public.admin_update_role_permissions('$org'::uuid,
      '$role_id'::uuid,ARRAY['billing.manage']::text[],ARRAY[]::text[]);
    COMMIT;"
  "${pg[@]}" -c "$editor_sql" > "$workdir/$mode.editor.out" 2>"$workdir/$mode.editor.err" &
  a_pid=$!
  wait_for_editor_lock
  "${pg[@]}" -c "SET lock_timeout='10s';
      UPDATE public.roles SET name=name||' | modified'
      WHERE id='$role_id'::uuid;" >"$workdir/$mode.writer.out" 2>"$workdir/$mode.writer.err" &
  b_pid=$!
  wait "$a_pid" || a_rc=$?
  wait "$b_pid" || b_rc=$?
  printf '%s %s' "$a_rc" "$b_rc"
}

# OLD function (real production body) takes a role row lock first, then trigger
# takes global advisory lock; a parallel BEFORE STATEMENT UPDATE inverts order.
status="$(run_race legacy)"
read -r a_rc b_rc <<<"$status"
if [[ "$a_rc" == '0' && "$b_rc" == '0' ]] ||
   ! grep -qi 'deadlock detected' "$workdir/legacy.editor.err" "$workdir/legacy.writer.err"; then
  echo "Expected genuine 40P01 lock inversion was not reproduced: $status" >&2
  cat "$workdir"/legacy.*.err >&2
  exit 1
fi
# Clear only fake rows and audit before verifying the repair. Other fixture
# tenants/roles remain untouched.
"${pg[@]}" -c "DELETE FROM public.role_permissions WHERE role_id='$role_id'::uuid;
  DELETE FROM public.audit_log WHERE entity_id='$role_id'::uuid;
  UPDATE public.roles SET name='Role changed concurrently' WHERE id='$role_id'::uuid;" >/dev/null

# The candidate is refused unless the existing function matches live hash.
"${pg[@]}" -f security/candidates/admin_update_role_permissions_billing_lock.sql   > "$workdir/upgrade.out" 2>"$workdir/upgrade.err" || {
    cat "$workdir/upgrade.err" >&2; exit 1;
  }
status="$(run_race guarded)"
read -r a_rc b_rc <<<"$status"
if [[ "$a_rc" != '0' || "$b_rc" != '0' ]]; then
  echo "Guarded authorizations should finish serially without deadlock: $status" >&2
  cat "$workdir"/guarded.*.err >&2
  exit 1
fi
# Exactly one successful role edit + one row update; no duplicate audit, no
# partial second grant, no accidentally authorized Wompi payment.
read -r grants audit changed orders <<<"$("${pg[@]}" -At -F ' ' -c "
  SELECT
    (SELECT COUNT(*) FROM public.role_permissions
      WHERE role_id='$role_id'::uuid),
    (SELECT COUNT(*) FROM public.audit_log
      WHERE entity_id='$role_id'::uuid AND action='role.permissions_changed'),
    (SELECT COUNT(*) FROM public.roles
      WHERE id='$role_id'::uuid AND name='Role changed concurrently | modified'),
    (SELECT COUNT(*) FROM public.payment_orders);")"
if [[ "$grants" != '1' || "$audit" != '1' || "$changed" != '1' || "$orders" != '0' ]]; then
  echo "Guarded role-edit audit or payment state invalid: grants=$grants audit=$audit role=$changed orders=$orders" >&2
  exit 1
fi
# Syntax/body integrity: lock must precede the first read/lock.
"${pg[@]}" -c "DO \$\$ DECLARE src text; BEGIN
 SELECT prosrc INTO src FROM pg_proc
 WHERE oid='public.admin_update_role_permissions(uuid,uuid,text[],text[])'::regprocedure;
 IF strpos(src,'pg_advisory_xact_lock')=0 OR
 strpos(src,'pg_advisory_xact_lock')>strpos(src,'FOR UPDATE') THEN
 RAISE EXCEPTION 'Authorization advisory lock comes after role FOR UPDATE';
 END IF; END \$\$;" >/dev/null
echo "PASS: legacy live body reproducibly deadlocks; guarded RPC serializes role updates; no extra orders or audit"
