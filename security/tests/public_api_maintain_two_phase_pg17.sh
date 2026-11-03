#!/usr/bin/env bash
# Isolated PostgreSQL 17 CI ONLY. Never point this at Supabase or Railway.
set -euo pipefail
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD="${PGPASSWORD:-postgres}"
[[ "${PGHOST}" == localhost && "${PGPORT}" == 5432 && "${PGUSER}" == postgres ]] || exit 2
db=jco_maintain_two_phase_test
phase1=security/candidates/revoke_public_api_maintain_postgres_phase.sql
phase2=security/candidates/revoke_public_api_maintain_supabase_admin_phase.sql
cleanup() {
  code=$?
  trap - EXIT
  psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" || code=1
  psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP ROLE IF EXISTS anon,authenticated,service_role,supabase_admin" || code=1
  exit "$code"
}
trap cleanup EXIT
psql -X -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $db"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE supabase_admin NOLOGIN;
GRANT CREATE,USAGE ON SCHEMA public TO supabase_admin;
GRANT USAGE ON SCHEMA public TO anon,authenticated;
CREATE TABLE public.financial_records (
  id int PRIMARY KEY, org uuid NOT NULL, amount int NOT NULL);
INSERT INTO public.financial_records VALUES
 (1,'11111111-1111-4111-8111-111111111111',100),
 (2,'22222222-2222-4222-8222-222222222222',200);
ALTER TABLE public.financial_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_finance ON public.financial_records TO authenticated
  USING (org=current_setting('app.org_id',true)::uuid)
  WITH CHECK (org=current_setting('app.org_id',true)::uuid);
GRANT SELECT,INSERT,UPDATE ON public.financial_records TO authenticated;
GRANT MAINTAIN ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
 GRANT MAINTAIN ON TABLES TO anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
 GRANT MAINTAIN ON TABLES TO anon,authenticated;
DO $check$
BEGIN
 IF NOT has_table_privilege('anon','public.financial_records','MAINTAIN')
    OR NOT has_table_privilege('authenticated','public.financial_records','MAINTAIN')
 THEN RAISE EXCEPTION 'Unsafe fixture grants absent'; END IF;
END
$check$;
SQL
# Each phase is owner-specific and must reject an incorrect executor without
# changing existing privileges; bypassing role membership is not permitted.
if psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$phase2" > /tmp/jco-maintain-phase2-denied.log 2>&1; then
  echo 'ERROR: supabase_admin phase accepted postgres'; exit 1
fi
grep -q 'MAINTAIN phase-2 blocked' /tmp/jco-maintain-phase2-denied.log
if psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'SET ROLE supabase_admin' -f "$phase1" > /tmp/jco-maintain-phase1-denied.log 2>&1; then
  echo 'ERROR: postgres phase accepted supabase_admin'; exit 1
fi
grep -q 'MAINTAIN phase-1 blocked' /tmp/jco-maintain-phase1-denied.log
[[ "$(psql -X -At -v ON_ERROR_STOP=1 -d "$db" -c "SELECT has_table_privilege('anon','public.financial_records','MAINTAIN')")" == t ]]
# First phase removes existing grants and postgres-created future defaults.
psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$phase1"
psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$phase1"
psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'CREATE TABLE public.after_postgres (id int)'
psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'SET ROLE supabase_admin' -c 'CREATE TABLE public.interim_supabase_admin (id int)'
# Demonstrate the remaining risk: until phase 2, a new supabase_admin-owned
# table still gets unsafe default MAINTAIN grants from its separate role.
[[ "$(psql -X -At -v ON_ERROR_STOP=1 -d "$db" -c "SELECT has_table_privilege('anon','public.interim_supabase_admin','MAINTAIN')")" == t ]]
[[ "$(psql -X -At -v ON_ERROR_STOP=1 -d "$db" -c "SELECT has_table_privilege('anon','public.after_postgres','MAINTAIN')")" == f ]]
# Phase 2 removes BOTH supabase_admin future defaults and grants on its
# own interim tables, even when they were created after the first phase.
psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'SET ROLE supabase_admin' -f "$phase2"
[[ "$(psql -X -At -v ON_ERROR_STOP=1 -d "$db" -c "SELECT has_table_privilege('anon','public.interim_supabase_admin','MAINTAIN')")" == f ]]
psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'SET ROLE supabase_admin' -f "$phase2"
psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'SET ROLE supabase_admin' -c 'CREATE TABLE public.after_supabase_admin (id int)'
[[ "$(psql -X -At -v ON_ERROR_STOP=1 -d "$db" -c "SELECT has_table_privilege('anon','public.after_supabase_admin','MAINTAIN')")" == f ]]
# Final postgres sweep is mandatory: clear postgres-owned objects created
# between phases; phase 2 independently cleaned supabase_admin-owned objects.
psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$phase1"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
DO $verify$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['financial_records','after_postgres',
                            'interim_supabase_admin','after_supabase_admin'] LOOP
  IF has_table_privilege('anon','public.'||t,'MAINTAIN')
     OR has_table_privilege('authenticated','public.'||t,'MAINTAIN')
   THEN RAISE EXCEPTION 'Unsafe public MAINTAIN grant after cleanup: %',t; END IF;
 END LOOP;
 IF NOT has_table_privilege('service_role','public.financial_records','MAINTAIN')
    OR NOT has_table_privilege('authenticated','public.financial_records','SELECT')
    OR NOT has_table_privilege('authenticated','public.financial_records','INSERT')
    OR NOT has_table_privilege('authenticated','public.financial_records','UPDATE')
    OR NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid='public.financial_records'::regclass)
 THEN RAISE EXCEPTION 'Business grants, service role or RLS damaged'; END IF;
 IF EXISTS(
  SELECT 1 FROM pg_default_acl d
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE d.defaclnamespace='public'::regnamespace AND d.defaclobjtype='r'
   AND pg_get_userbyid(d.defaclrole) IN ('postgres','supabase_admin')
   AND a.grantee IN ('anon'::regrole,'authenticated'::regrole)
   AND a.privilege_type='MAINTAIN'
 ) THEN RAISE EXCEPTION 'Unsafe future default MAINTAIN grants remain'; END IF;
END
$verify$;
SET ROLE authenticated;
SELECT set_config('app.org_id','11111111-1111-4111-8111-111111111111',false);
DO $tenant$
BEGIN
 IF (SELECT count(*) FROM public.financial_records) <> 1
    OR (SELECT amount FROM public.financial_records) <> 100
 THEN RAISE EXCEPTION 'Tenant A RLS boundary failed'; END IF;
END
$tenant$;
SELECT set_config('app.org_id','22222222-2222-4222-8222-222222222222',false);
DO $tenant$
BEGIN
 IF (SELECT count(*) FROM public.financial_records) <> 1
    OR (SELECT amount FROM public.financial_records) <> 200
 THEN RAISE EXCEPTION 'Tenant B RLS boundary failed'; END IF;
END
$tenant$;
RESET ROLE;
SQL
echo 'PASS: phased MAINTAIN remediation, denied executors, final sweep and two tenant RLS checks'
