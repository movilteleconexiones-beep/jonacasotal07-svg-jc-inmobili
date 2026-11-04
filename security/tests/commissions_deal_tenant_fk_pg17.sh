#!/usr/bin/env bash
# PostgreSQL 17 disposable CI ONLY. No production Supabase access.
set -euo pipefail
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD="${PGPASSWORD:-postgres}"
[[ "$PGHOST" == localhost && "$PGPORT" == 5432 && "$PGUSER" == postgres ]] || exit 2
db=jco_commissions_deal_fk_test
candidate=security/candidates/commissions_deal_tenant_fk.sql
log="${RUNNER_TEMP:-/tmp}/jco-commission-deal-denial.log"
cleanup() {
  code=$?
  trap - EXIT
  psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" || code=1
  psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP ROLE IF EXISTS anon,authenticated,service_role" || code=1
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
CREATE TABLE public.deals(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES public.organizations(id)
);
CREATE TABLE public.commissions(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES public.organizations(id),
 deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
 amount numeric NOT NULL
);
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY deal_tenant ON public.deals FOR ALL TO authenticated
 USING(organization_id=current_setting('app.tenant_id',true)::uuid)
 WITH CHECK(organization_id=current_setting('app.tenant_id',true)::uuid);
CREATE POLICY commission_tenant ON public.commissions FOR ALL TO authenticated
 USING(organization_id=current_setting('app.tenant_id',true)::uuid)
 WITH CHECK(organization_id=current_setting('app.tenant_id',true)::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.deals,public.commissions TO authenticated;
GRANT ALL ON public.deals,public.commissions TO service_role;
INSERT INTO public.organizations VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.deals VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222');
INSERT INTO public.commissions VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',100),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',200);
SQL
# Demonstrate the real defect BEFORE corrective DDL: authenticated
# tenant A can link to B's deal despite being unable to read B's rows.
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true);
INSERT INTO public.commissions VALUES
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',300);
DO $pre$
BEGIN
 IF (SELECT count(*) FROM public.commissions)<>2
 THEN RAISE EXCEPTION 'Synthetic original FK did not reproduce cross-tenant reference'; END IF;
END
$pre$;
ROLLBACK;
SQL
# A real mismatched row must block entire remediation, without adding UNIQUE.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "INSERT INTO public.commissions VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',300)"
if psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate" > "$log" 2>&1; then
 echo 'ERROR: accepted existing cross-tenant commission'; exit 1
fi
grep -q 'existing cross-tenant or orphan commissions' "$log"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT count(*) FROM pg_constraint WHERE conrelid='public.deals'::regclass AND conname='deals_organization_id_id_unique'")" == 0 ]] ||
 { echo 'ERROR: failed preflight made partial changes'; exit 1; }
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "DELETE FROM public.commissions WHERE id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'"
# Must block a role other than the schema owner.
if psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'SET ROLE authenticated' -f "$candidate" > "$log" 2>&1; then
 echo 'ERROR: unauthorized role accepted DDL'; exit 1
fi
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT count(*) FROM pg_constraint WHERE conrelid='public.deals'::regclass AND conname='deals_organization_id_id_unique'")" == 0 ]] ||
 { echo 'ERROR: unauthorized role made partial changes'; exit 1; }
# Only one FK is ever exposed from commissions to deals. Avoid PostgREST
# ambiguous embed relationship (two joins to the same table).
psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate"
psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
DO $verify$
BEGIN
 IF (SELECT count(*) FROM pg_constraint
   WHERE conrelid='public.commissions'::regclass AND contype='f'
   AND confrelid='public.deals'::regclass)<>1
 THEN RAISE EXCEPTION 'Multiple PostgREST FK relationships to deals'; END IF;
 IF NOT EXISTS(
   SELECT 1 FROM pg_constraint
   WHERE conrelid='public.commissions'::regclass
   AND conname='commissions_deal_id_fkey' AND convalidated
   AND pg_get_constraintdef(oid,true)=
     'FOREIGN KEY (organization_id, deal_id) REFERENCES deals(organization_id, id) ON DELETE CASCADE'
 ) THEN RAISE EXCEPTION 'Expected single composite FK missing'; END IF;
 IF NOT EXISTS(
   SELECT 1 FROM pg_constraint WHERE conrelid='public.deals'::regclass
   AND conname='deals_organization_id_id_unique'
   AND pg_get_constraintdef(oid,true)='UNIQUE (organization_id, id)'
 ) THEN RAISE EXCEPTION 'Required composite UNIQUE missing'; END IF;
 IF (SELECT count(*) FROM public.commissions)<>2 OR
    NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.commissions'::regclass) OR
    NOT has_table_privilege('authenticated','public.commissions','INSERT') OR
    NOT has_table_privilege('service_role','public.commissions','SELECT')
 THEN RAISE EXCEPTION 'Records/RLS/API grants changed unexpectedly'; END IF;
END
$verify$;
SQL
# Even PostgreSQL owner cannot create cross-organization payment associations.
if psql -X -v ON_ERROR_STOP=1 -d "$db" -c "INSERT INTO public.commissions VALUES('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',300)" > "$log" 2>&1; then
 echo 'ERROR: composite FK permits cross-tenant commission'; exit 1
fi
grep -q 'commissions_deal_id_fkey' "$log"
# Preserve legit tenant A and B access.
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true);
DO $tenant$
BEGIN
 IF (SELECT count(*) FROM public.commissions)<>1
   OR (SELECT amount FROM public.commissions)<>100
 THEN RAISE EXCEPTION 'Tenant A financial RLS drift'; END IF;
END
$tenant$;
INSERT INTO public.commissions VALUES
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',300);
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true);
DO $tenant$
BEGIN
 IF (SELECT count(*) FROM public.commissions)<>1
   OR (SELECT amount FROM public.commissions)<>200
 THEN RAISE EXCEPTION 'Tenant B financial RLS drift'; END IF;
END
$tenant$;
ROLLBACK;
SQL
# The legacy ON DELETE CASCADE semantics remain.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "DELETE FROM public.deals WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT count(*) FROM public.commissions")" == 1 ]] ||
 { echo 'ERROR: ON DELETE CASCADE no longer works'; exit 1; }
echo 'PASS: one FK for PostgREST; commission/deal composite tenant isolation, cascade, grants, RLS, idempotence.'
