#!/usr/bin/env bash
# CI-only recovery exercise using fictional data and ephemeral PostgreSQL 17.
# Never connects to Supabase or any production database.
set -euo pipefail

if [[ "${JCO_RECOVERY_FIXTURE_CI:-}" != "1" ]]; then
  echo "This isolated restore fixture requires JCO_RECOVERY_FIXTURE_CI=1" >&2
  exit 65
fi

# Pin the client to CI localhost; discard environment overrides.
unset PGHOSTADDR PGSERVICE PGDATABASE PGOPTIONS PGCONNECT_TIMEOUT
export PGHOST="127.0.0.1" PGPORT="5432" PGUSER="postgres"

for program in psql createdb dropdb pg_dump pg_restore sha256sum; do
  command -v "$program" >/dev/null || { echo "Missing $program" >&2; exit 66; }
done

# Require the specific GitHub CI seed database, not an arbitrary endpoint.
if ! psql -X -v ON_ERROR_STOP=1 -d postgres -Atc "select exists(select 1 from pg_database where datname = 'jco_security_test')" | grep -qx t; then
  echo "Refusing exercise: CI database marker missing" >&2
  exit 67
fi

suffix="${RANDOM}${RANDOM}$$"
source_db="jco_fake_source_${suffix}"
restore_db="jco_fake_restore_${suffix}"
role="jco_fake_reader_${suffix}"
dir="$(mktemp -d)"
cleanup() {
  dropdb --if-exists "$restore_db" >/dev/null 2>&1 || true
  dropdb --if-exists "$source_db" >/dev/null 2>&1 || true
  psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP ROLE IF EXISTS $role" >/dev/null 2>&1 || true
  rm -rf -- "$dir"
}
trap cleanup EXIT

createdb "$source_db"
createdb "$restore_db"
psql -X -v ON_ERROR_STOP=1 -d postgres -c "CREATE ROLE $role NOLOGIN" >/dev/null

psql -X -v ON_ERROR_STOP=1 -d "$source_db" >/dev/null <<'SQL'
CREATE TABLE public.recovery_fixture (
  organization_id uuid NOT NULL,
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  memo text NOT NULL
);
ALTER TABLE public.recovery_fixture ENABLE ROW LEVEL SECURITY;
CREATE POLICY recovery_tenant_read ON public.recovery_fixture FOR SELECT
  USING (organization_id::text = current_setting('jco.tenant', true));
INSERT INTO public.recovery_fixture (organization_id, memo) VALUES
('11111111-1111-1111-1111-111111111111', 'FAKE TENANT A'),
('22222222-2222-2222-2222-222222222222', 'FAKE TENANT B');
SQL

pg_dump --format=custom --no-owner --no-acl --file="$dir/source.dump" "$source_db"
sha256sum "$dir/source.dump" | awk '{print $1}' > "$dir/original.sha256"
pg_restore --list "$dir/source.dump" > "$dir/dump.toc"
grep -q 'TABLE.*recovery_fixture' "$dir/dump.toc"

pg_restore --exit-on-error --no-owner --no-acl --dbname="$restore_db" "$dir/source.dump"
sha256sum "$dir/source.dump" | awk '{print $1}' > "$dir/restored.sha256"
cmp "$dir/original.sha256" "$dir/restored.sha256" >/dev/null

psql -X -v ON_ERROR_STOP=1 -d "$restore_db" >/dev/null <<SQL
DO \$\$ BEGIN
 IF (SELECT COUNT(*) FROM public.recovery_fixture) != 2 THEN RAISE EXCEPTION 'Fake row count mismatch'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.recovery_fixture'::regclass) THEN RAISE EXCEPTION 'RLS not restored'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='recovery_fixture' AND policyname='recovery_tenant_read') THEN RAISE EXCEPTION 'RLS policy not restored'; END IF;
END \$\$;
GRANT USAGE ON SCHEMA public TO $role;
GRANT SELECT ON public.recovery_fixture TO $role;
SET ROLE $role;
SET jco.tenant = '11111111-1111-1111-1111-111111111111';
DO \$\$ BEGIN IF (SELECT COUNT(*) FROM public.recovery_fixture) != 1 THEN RAISE EXCEPTION 'Tenant A RLS isolation failed'; END IF; END \$\$;
SET jco.tenant = '22222222-2222-2222-2222-222222222222';
DO \$\$ BEGIN IF (SELECT COUNT(*) FROM public.recovery_fixture) != 1 THEN RAISE EXCEPTION 'Tenant B RLS isolation failed'; END IF; END \$\$;
RESET ROLE;
SQL

echo "PASS: fictional PG17 dump/restore on localhost; SHA-256, row count and tenant RLS validated."
echo "NOT A BACKUP: no production data or Storage objects copied; no real restoration verified."
