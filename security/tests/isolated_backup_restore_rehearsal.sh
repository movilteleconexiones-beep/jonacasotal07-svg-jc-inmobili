#!/usr/bin/env bash
# CI ONLY: restore fabricated Postgres fixture data; NEVER connect to production.
set -euo pipefail

# The runner's PostgreSQL 17 service owns both disposable databases below.
# Do not repurpose this script with production credentials or custom URLs.
SOURCE_DB=jco_property_boundary_test
RESTORE_DB=jco_ci_restore_fixture_test
BACKUP_FILE="$(mktemp "$RUNNER_TEMP/jco-fixture-backup-XXXXXX")"
trap 'rm -f "$BACKUP_FILE"' EXIT

: "$PGPASSWORD"
if [[ "$PGPASSWORD" != "postgres" ]]; then
  echo "Refusing to use anything except the CI fixture password." >&2
  exit 1
fi

# Use a PG17 client matching the synthetic server; no production secrets.
docker run --rm --network host -e PGPASSWORD=postgres \
  -v "$BACKUP_FILE:/ci-fixture.backup" postgres:17 \
  pg_dump --host=127.0.0.1 --username=postgres --dbname="$SOURCE_DB" \
    --format=custom --no-owner --file=/ci-fixture.backup

test -s "$BACKUP_FILE"
docker run --rm --network host \
  -v "$BACKUP_FILE:/ci-fixture.backup:ro" postgres:17 \
  pg_restore --list /ci-fixture.backup >/dev/null

psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d postgres \
  -c "CREATE DATABASE $RESTORE_DB" >/dev/null

docker run --rm --network host -e PGPASSWORD=postgres \
  -v "$BACKUP_FILE:/ci-fixture.backup:ro" postgres:17 \
  pg_restore --host=127.0.0.1 --username=postgres \
    --dbname="$RESTORE_DB" --no-owner --exit-on-error /ci-fixture.backup

# Fake fixture records and RLS must survive the round-trip, including public
# grants and the platform admin policy. This is never a production backup.
result="$(psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d "$RESTORE_DB" -tA -c "
 SELECT (SELECT count(*) FROM public.properties)=2
    AND (SELECT count(*) FROM pg_policies WHERE schemaname='public'
         AND tablename='properties'
         AND policyname='jco_private_properties_tenant_read_boundary')=1
    AND NOT has_table_privilege('anon','public.properties','SELECT')
    AND NOT has_table_privilege('anon','public.properties','INSERT')
    AND NOT has_table_privilege('anon','public.properties','UPDATE')
    AND NOT has_table_privilege('anon','public.properties','DELETE')
    AND (SELECT count(*) FROM pg_policies WHERE schemaname='public'
         AND tablename='properties'
         AND policyname='jco_platform_admin_properties_read')=1;
")"
if [[ "$result" != "t" ]]; then
  echo "Simulated backup did not restore RLS policies and fixture rows." >&2
  exit 1
fi

echo "Fixture PostgreSQL backup/restoration verified, with RLS and private grants."
echo "This is NOT a production backup or real Supabase Storage restoration."
