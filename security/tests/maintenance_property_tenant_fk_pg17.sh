#!/usr/bin/env bash
# Only a disposable PostgreSQL 17 CI instance. Never run on production.
set -euo pipefail
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD="${PGPASSWORD:-postgres}"
[[ "$PGHOST" == localhost && "$PGPORT" == 5432 && "$PGUSER" == postgres ]] || exit 2
db=jco_maintenance_property_tenant_fk_test
candidate=security/candidates/maintenance_requests_property_tenant_fk.sql
log="${RUNNER_TEMP:-/tmp}/jco-maintenance-property-tenant-fk.log"
cleanup(){
  code=$?
  trap - EXIT
  psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" || code=1
  psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP ROLE IF EXISTS anon, authenticated, service_role" || code=1
  exit "$code"
}
trap cleanup EXIT
psql -X -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $db"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.properties(
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 CONSTRAINT financial_properties_tenant_id_unique UNIQUE(organization_id,id)
);
CREATE TABLE public.maintenance_requests(
 id integer PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
 title text NOT NULL
);
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY properties_org ON public.properties FOR ALL TO authenticated
 USING (organization_id=current_setting('app.tenant_id',true)::uuid)
 WITH CHECK (organization_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY maintenance_org_access ON public.maintenance_requests FOR ALL TO authenticated
 USING (organization_id=current_setting('app.tenant_id',true)::uuid)
 WITH CHECK (organization_id=current_setting('app.tenant_id',true)::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.maintenance_requests TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.properties TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.maintenance_requests TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.properties TO service_role;
INSERT INTO public.organizations VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.properties VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222');
INSERT INTO public.maintenance_requests VALUES
 (1,'11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Maintenance A'),
 (2,'22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Maintenance B');
SQL
# Before the composite FK, a tenant A writer passes RLS while referencing B's property.
# The fake cross-org row is rolled back. This demonstrates the precise gap.
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true);
INSERT INTO public.maintenance_requests VALUES
 (3,'11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Cross-org prior flaw');
DO $pre$
BEGIN
 IF (SELECT count(*) FROM public.maintenance_requests WHERE id=3)<>1
 THEN RAISE EXCEPTION 'Fixture did not reproduce cross-org FK vulnerability'; END IF;
END $pre$;
ROLLBACK;
SQL
# Preexisting cross-org links must abort without partial schema changes.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "INSERT INTO public.maintenance_requests VALUES (3,'11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Fixture invalid')"
if psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate" > "$log" 2>&1; then
 echo 'ERROR: migration accepted cross-tenant existing row'; exit 1
fi
grep -q 'existing cross-tenant/dangling records' "$log"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT count(*) FROM pg_constraint WHERE conrelid='public.maintenance_requests'::regclass AND conname='maintenance_requests_property_id_fkey' AND cardinality(conkey)=2")" == 0 ]] ||
  { echo 'ERROR: failed preflight created a partial FK'; exit 1; }
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "DELETE FROM public.maintenance_requests WHERE id=3"
# An unauthorized executor must not apply DDL.
if psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'SET ROLE authenticated' -f "$candidate" > "$log" 2>&1; then
 echo 'ERROR: unauthorized authenticated executor changed constraints'; exit 1
fi
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT count(*) FROM pg_constraint WHERE conrelid='public.maintenance_requests'::regclass AND conname='maintenance_requests_property_id_fkey' AND cardinality(conkey)=2")" == 0 ]] ||
  { echo 'ERROR: denied role left an FK'; exit 1; }
# Duplicate paths to properties must be rejected before modifying the old FK.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_duplicate_property_fk FOREIGN KEY(property_id) REFERENCES public.properties(id)"
if psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate" > "$log" 2>&1; then
 echo 'ERROR: accepted ambiguous parallel FK to properties'; exit 1
fi
grep -q 'single PostgREST FK contract changed' "$log"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT cardinality(conkey) FROM pg_constraint WHERE conrelid='public.maintenance_requests'::regclass AND conname='maintenance_requests_property_id_fkey'")" == 1 ]] ||
 { echo 'ERROR: ambiguous FK preflight changed legacy FK'; exit 1; }
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "ALTER TABLE public.maintenance_requests DROP CONSTRAINT maintenance_duplicate_property_fk"
# Original owner applies; rerun must be idempotent.
psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate"
psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
DO $assert$
DECLARE
  c record;
BEGIN
 SELECT convalidated,confdeltype,pg_get_constraintdef(oid,true) AS definition
 INTO c FROM pg_constraint WHERE conrelid='public.maintenance_requests'::regclass
 AND conname='maintenance_requests_property_id_fkey';
 IF c.convalidated IS DISTINCT FROM true OR c.confdeltype<>'c'
   OR c.definition <> 'FOREIGN KEY (organization_id, property_id) REFERENCES properties(organization_id, id) ON DELETE CASCADE'
 THEN RAISE EXCEPTION 'Composite FK missing, invalid or changed cascade'; END IF;
 IF (SELECT count(*) FROM pg_constraint
   WHERE conrelid='public.maintenance_requests'::regclass
     AND contype='f' AND confrelid='public.properties'::regclass) <> 1
 THEN RAISE EXCEPTION 'Duplicate maintenance/property relationship (PGRST201)'; END IF;
 IF (SELECT count(*) FROM public.maintenance_requests)<>2
   OR NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid='public.maintenance_requests'::regclass)
   OR NOT has_table_privilege('service_role','public.maintenance_requests','SELECT')
   OR NOT has_table_privilege('authenticated','public.maintenance_requests','UPDATE')
 THEN RAISE EXCEPTION 'Existing records, service rights or RLS changed'; END IF;
END
$assert$;
SQL
# A privileged SQL session must not be able to link tenant A to B's property.
if psql -X -v ON_ERROR_STOP=1 -d "$db" -c "INSERT INTO public.maintenance_requests VALUES (3,'11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Cross org blocked')" > "$log" 2>&1; then
 echo 'ERROR: composite FK allowed a cross-tenant property'; exit 1
fi
grep -q 'maintenance_requests_property_id_fkey' "$log"
# Confirm real staff RLS and original valid operations for each fake tenant.
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true);
DO $tenant$
BEGIN
 IF (SELECT count(*) FROM public.maintenance_requests)<>1
   OR (SELECT title FROM public.maintenance_requests)<>'Maintenance A'
 THEN RAISE EXCEPTION 'Tenant A select RLS drift'; END IF;
END
$tenant$;
INSERT INTO public.maintenance_requests VALUES
 (3,'11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Tenant A valid');
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true);
DO $tenant$
BEGIN
 IF (SELECT count(*) FROM public.maintenance_requests)<>1
   OR (SELECT title FROM public.maintenance_requests)<>'Maintenance B'
 THEN RAISE EXCEPTION 'Tenant B select RLS drift'; END IF;
END
$tenant$;
ROLLBACK;
SQL
# Original ON DELETE CASCADE remains with exactly one PostgREST relationship.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "DELETE FROM public.properties WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT count(*) FROM public.maintenance_requests")" == 1 ]] ||
 { echo 'ERROR: property delete cascade changed'; exit 1; }
echo 'PASS: single named PostgREST maintenance FK, cross-org isolation, fail-closed drift, RLS and cascade.'
