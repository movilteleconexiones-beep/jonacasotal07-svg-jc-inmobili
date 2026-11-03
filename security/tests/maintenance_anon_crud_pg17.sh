#!/usr/bin/env bash
# Disposable PostgreSQL 17 ONLY; no live Supabase access, no tenant data.
set -euo pipefail
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD="${PGPASSWORD:-postgres}"
db=jco_maintenance_anon_crud_test
candidate=security/candidates/revoke_maintenance_requests_anon_crud.sql
log="${RUNNER_TEMP:-/tmp}/jco-maintenance-anon-crud-denied.log"
cleanup() {
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
CREATE TABLE public.maintenance_requests(
  id int PRIMARY KEY, organization_id uuid NOT NULL,
  title text NOT NULL
);
INSERT INTO public.maintenance_requests VALUES
 (1,'11111111-1111-4111-8111-111111111111','Synthetic tenant A'),
 (2,'22222222-2222-4222-8222-222222222222','Synthetic tenant B');
ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
CREATE SCHEMA jco_private;
GRANT USAGE ON SCHEMA jco_private TO authenticated;
CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS
$ SELECT false $;
CREATE FUNCTION jco_private.is_internal_staff(p_org uuid) RETURNS boolean LANGUAGE sql STABLE AS
$ SELECT p_org=current_setting('app.tenant_id',true)::uuid $;
CREATE FUNCTION jco_private.operational_access(p_org uuid) RETURNS boolean LANGUAGE sql STABLE AS
$ SELECT current_setting('app.operational',true)='enabled'
      AND p_org=current_setting('app.tenant_id',true)::uuid $;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION jco_private.is_internal_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION jco_private.operational_access(uuid) TO authenticated;
CREATE POLICY maintenance_org_access ON public.maintenance_requests
 AS PERMISSIVE FOR ALL TO authenticated
 USING (is_platform_admin() OR jco_private.is_internal_staff(organization_id))
 WITH CHECK (is_platform_admin() OR jco_private.is_internal_staff(organization_id));
CREATE POLICY jco_commercial_access ON public.maintenance_requests
 AS RESTRICTIVE FOR ALL TO authenticated
 USING (jco_private.operational_access(organization_id)
   AND (is_platform_admin() OR jco_private.is_internal_staff(organization_id)))
 WITH CHECK (jco_private.operational_access(organization_id)
   AND (is_platform_admin() OR jco_private.is_internal_staff(organization_id)));
GRANT SELECT,INSERT,UPDATE,DELETE,MAINTAIN ON public.maintenance_requests
 TO anon,authenticated;
GRANT ALL ON public.maintenance_requests TO service_role;
DO $check$
BEGIN
 IF NOT (has_table_privilege('anon','public.maintenance_requests','SELECT')
   AND has_table_privilege('anon','public.maintenance_requests','INSERT')
   AND has_table_privilege('anon','public.maintenance_requests','UPDATE')
   AND has_table_privilege('anon','public.maintenance_requests','DELETE')
   AND has_table_privilege('anon','public.maintenance_requests','MAINTAIN'))
 THEN RAISE EXCEPTION 'Fixture lacks actual observed excessive grants'; END IF;
END
$check$;
SET ROLE anon;
DO $check$
BEGIN
 IF (SELECT count(*) FROM public.maintenance_requests) <> 0 THEN
  RAISE EXCEPTION 'Anon bypassed authenticated-only RLS before revocation';
 END IF;
END
$check$;
RESET ROLE;
SQL
# Preflight must refuse incorrect actor before touching any privilege.
if psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'SET ROLE authenticated' -f "$candidate" > "$log" 2>&1; then
  echo 'ERROR: unauthorized executor accepted candidate'; exit 1
fi
grep -q 'maintenance anon CRUD blocked: must execute AS postgres' "$log"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT has_table_privilege('anon','public.maintenance_requests','SELECT')")" == t ]] ||
  { echo 'ERROR: denied executor mutated ACL'; exit 1; }

# If a future anonymous policy appears, the candidate must reject the drift.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "CREATE POLICY maintenance_public_future ON public.maintenance_requests FOR SELECT TO anon USING (true)"
if psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate" > "$log" 2>&1; then
  echo 'ERROR: unsafe new anonymous policy was ignored'; exit 1
fi
grep -q 'maintenance anon CRUD blocked: RLS policy contract changed' "$log"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT has_table_privilege('anon','public.maintenance_requests','SELECT')")" == t ]] ||
  { echo 'ERROR: policy-drift denial mutated ACL'; exit 1; }
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "DROP POLICY maintenance_public_future ON public.maintenance_requests"

# Names and roles alone are insufficient: a relaxed WITH CHECK must fail closed.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "ALTER POLICY maintenance_org_access ON public.maintenance_requests WITH CHECK (true)"
if psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate" > "$log" 2>&1; then
  echo 'ERROR: asymmetric RLS policy accepted'; exit 1
fi
grep -q 'maintenance anon CRUD blocked: asymmetric RLS policy expressions' "$log"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT has_table_privilege('anon','public.maintenance_requests','SELECT')")" == t ]] ||
  { echo 'ERROR: asymmetric RLS denial mutated ACL'; exit 1; }
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "ALTER POLICY maintenance_org_access ON public.maintenance_requests WITH CHECK (true)"

# Symmetric widening previously escaped the structural/asymmetry guard.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "ALTER POLICY maintenance_org_access ON public.maintenance_requests USING (true) WITH CHECK (true)"
if psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate" > "$log" 2>&1; then
  echo 'ERROR: symmetric RLS widening accepted'; exit 1
fi
grep -q 'maintenance anon CRUD blocked: RLS policy semantic baseline changed' "$log"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT has_table_privilege('anon','public.maintenance_requests','SELECT')")" == t ]] ||
  { echo 'ERROR: symmetric policy drift changed ACL'; exit 1; }
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "ALTER POLICY maintenance_org_access ON public.maintenance_requests USING (is_platform_admin() OR jco_private.is_internal_staff(organization_id)) WITH CHECK (is_platform_admin() OR jco_private.is_internal_staff(organization_id))"

# RLS must remain enabled: an unexpected table-level disable must fail
# before the candidate can revoke privileges or claim a safe deployment.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "ALTER TABLE public.maintenance_requests DISABLE ROW LEVEL SECURITY"
if psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate" > "$log" 2>&1; then
  echo 'ERROR: disabled RLS was accepted'; exit 1
fi
grep -q 'maintenance anon CRUD blocked: expected postgres-owned RLS table' "$log"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT has_table_privilege('anon','public.maintenance_requests','SELECT')")" == t ]] ||
  { echo 'ERROR: disabled-RLS denial mutated ACL'; exit 1; }
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY"

# Every PUBLIC CRUD grant is inherited by anon; check all four independently.
# A failed preflight must preserve the original ACL (transaction rollback).
for privilege in SELECT INSERT UPDATE DELETE; do
  psql -X -v ON_ERROR_STOP=1 -d "$db" -c "GRANT $privilege ON public.maintenance_requests TO PUBLIC"
  if psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate" > "$log" 2>&1; then
    echo "ERROR: PUBLIC $privilege grant bypass was ignored"; exit 1
  fi
  grep -q 'maintenance anon CRUD blocked: PUBLIC privileges remain' "$log"
  [[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) acl WHERE c.oid='public.maintenance_requests'::regclass AND acl.grantee=0 AND acl.privilege_type='$privilege')")" == t ]] ||
    { echo "ERROR: denied candidate modified PUBLIC $privilege ACL"; exit 1; }
  psql -X -v ON_ERROR_STOP=1 -d "$db" -c "REVOKE $privilege ON public.maintenance_requests FROM PUBLIC"
done

# An inherited grant can keep anonymous CRUD effective after direct REVOKE.
# The postcondition must reject and roll back the entire transaction.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "GRANT authenticated TO anon"
if psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate" > "$log" 2>&1; then
  echo 'ERROR: inherited authenticated CRUD escaped the postcondition'; exit 1
fi
grep -q 'maintenance anon CRUD revocation not effective' "$log"
[[ "$(psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "SELECT has_table_privilege('anon','public.maintenance_requests','SELECT')")" == t ]] ||
  { echo 'ERROR: inherited-grant failure did not roll back'; exit 1; }
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "REVOKE authenticated FROM anon"

# Authorized simulated postgres owner: repeat to verify idempotence.
psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate"
psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$candidate"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
DO $verify$
DECLARE privilege text;
BEGIN
 FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
  IF has_table_privilege('anon','public.maintenance_requests',privilege) THEN
   RAISE EXCEPTION 'Unexpected anon CRUD privilege: %',privilege;
  END IF;
  IF NOT has_table_privilege('authenticated','public.maintenance_requests',privilege)
     OR NOT has_table_privilege('service_role','public.maintenance_requests',privilege) THEN
   RAISE EXCEPTION 'Business / service role privilege lost: %',privilege;
  END IF;
 END LOOP;
 IF NOT has_table_privilege('anon','public.maintenance_requests','MAINTAIN')
   OR NOT has_table_privilege('authenticated','public.maintenance_requests','MAINTAIN')
   OR NOT has_table_privilege('service_role','public.maintenance_requests','MAINTAIN') THEN
    RAISE EXCEPTION 'This candidate must NOT alter MAINTAIN; separate fix pending';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class
   WHERE oid='public.maintenance_requests'::regclass)
   OR (SELECT count(*) FROM public.maintenance_requests) <> 2
 THEN RAISE EXCEPTION 'RLS or original data changed'; END IF;
END
$verify$;
SQL
if psql -X -v ON_ERROR_STOP=1 -d "$db" -c "SET ROLE anon; SELECT count(*) FROM public.maintenance_requests" > "$log" 2>&1; then
 echo 'ERROR: anon table read unexpectedly succeeded after REVOKE'; exit 1
fi
grep -qi 'permission denied' "$log"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',true);
SELECT set_config('app.operational','enabled',true);
DO $tenant$
BEGIN
 IF (SELECT count(*) FROM public.maintenance_requests)<>1
   OR (SELECT title FROM public.maintenance_requests) <> 'Synthetic tenant A' THEN
  RAISE EXCEPTION 'Authenticated tenant A cannot read own single row';
 END IF;
END
$tenant$;
UPDATE public.maintenance_requests SET title='Tenant A edited' WHERE id=1;
DO $tenant$
BEGIN
 IF (SELECT title FROM public.maintenance_requests WHERE id=1)<>'Tenant A edited'
   OR EXISTS (SELECT 1 FROM public.maintenance_requests WHERE id=2) THEN
  RAISE EXCEPTION 'Cross-tenant isolation or authorized update failed';
 END IF;
END
$tenant$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('app.tenant_id','22222222-2222-4222-8222-222222222222',true);
SELECT set_config('app.operational','enabled',true);
DO $tenant$
BEGIN
 IF (SELECT count(*) FROM public.maintenance_requests)<>1
  OR (SELECT title FROM public.maintenance_requests) <> 'Synthetic tenant B' THEN
  RAISE EXCEPTION 'Authenticated tenant B RLS failed';
 END IF;
END
$tenant$;
ROLLBACK;
SQL
echo 'PASS: isolated anon CRUD hardening, fail-closed drift, staff/service grants and two-tenant RLS. MAINTAIN remains separate.'
