#!/usr/bin/env bash
# Synthetic PostgreSQL 17 test; NEVER connect this fixture to production.
set -euo pipefail
db="jco_restore_dependency_ci_$$"
trap 'dropdb --if-exists "$db" >/dev/null 2>&1 || true' EXIT
createdb "$db"
inspect() {
  psql -X -A -t -F '|' -v ON_ERROR_STOP=1 -d "$db" \
    -f scripts/backup/inspect_restore_dependencies.sql
}
assert_line() {
  local report="$1" expected="$2"
  if ! grep -Fqx "$expected" <<< "$report"; then
    printf 'Missing expected diagnostic: %s\nActual:\n%s\n' "$expected" "$report" >&2
    exit 1
  fi
}
report="$(inspect)"
assert_line "$report" 'auth.users id unique key|FALTA'
assert_line "$report" 'private.can_read_portal_property(uuid,uuid)|FALTA'
psql -X -v ON_ERROR_STOP=1 -d "$db" >/dev/null <<'SQL'
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE SCHEMA private;
CREATE FUNCTION private.can_read_portal_property(uuid,uuid)
RETURNS boolean LANGUAGE sql AS 'SELECT true';
SQL
report="$(inspect)"
assert_line "$report" 'auth.users id unique key|OK'
assert_line "$report" 'private.can_read_portal_property(uuid,uuid)|OK'
psql -X -v ON_ERROR_STOP=1 -d "$db" >/dev/null <<'SQL'
ALTER TABLE auth.users DROP CONSTRAINT users_pkey;
DROP FUNCTION private.can_read_portal_property(uuid,uuid);
SQL
report="$(inspect)"
assert_line "$report" 'auth.users id unique key|FALTA'
assert_line "$report" 'private.can_read_portal_property(uuid,uuid)|FALTA'
echo 'Synthetic restore dependency diagnostics passed; actual restore NOT certified.'
