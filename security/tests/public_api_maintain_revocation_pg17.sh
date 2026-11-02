#!/usr/bin/env bash
# PostgreSQL 17 disposable CI database ONLY. Never run against Supabase.
set -euo pipefail
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD="${PGPASSWORD:-postgres}"
db=jco_public_maintain_acl_test
# Roles are cluster-wide even when their test tables are database-local.
# Remove our disposable database AND its four synthetic roles on every exit,
# or the next pre-existing CI fixture will fail with "role already exists".
cleanup() {
  status=$?
  trap - EXIT
  psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" || status=1
  psql -X -v ON_ERROR_STOP=1 -d postgres -c "DROP ROLE IF EXISTS anon, authenticated, service_role, supabase_admin" || status=1
  exit "$status"
}
trap cleanup EXIT
psql -X -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $db"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE supabase_admin NOLOGIN;
GRANT CREATE, USAGE ON SCHEMA public TO supabase_admin;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TABLE public.organizations (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.financial_records (
  id integer PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations(id),
  amount numeric NOT NULL
);
INSERT INTO public.organizations VALUES
 ('11111111-1111-4111-8111-111111111111','Synthetic JCO A'),
 ('22222222-2222-4222-8222-222222222222','Synthetic JCO B');
INSERT INTO public.financial_records VALUES
 (1,'11111111-1111-4111-8111-111111111111',100),
 (2,'22222222-2222-4222-8222-222222222222',200);
ALTER TABLE public.financial_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_records ON public.financial_records
  TO authenticated USING (organization_id=current_setting('app.tenant_id',true)::uuid)
  WITH CHECK (organization_id=current_setting('app.tenant_id',true)::uuid);
GRANT SELECT, INSERT, UPDATE ON public.financial_records TO authenticated;
GRANT MAINTAIN ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT MAINTAIN ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT MAINTAIN ON TABLES TO anon, authenticated;
CREATE SCHEMA isolated;
CREATE TABLE isolated.unrelated (id int);
GRANT USAGE ON SCHEMA isolated TO authenticated;
GRANT MAINTAIN ON isolated.unrelated TO authenticated;
DO $$
BEGIN
 IF NOT has_table_privilege('anon','public.financial_records','MAINTAIN')
    OR NOT has_table_privilege('authenticated','public.financial_records','MAINTAIN')
 THEN RAISE EXCEPTION 'Fixture did not reproduce excessive MAINTAIN grants'; END IF;
END $$;
SQL
# Candidate may be applied twice; it must be idempotent and leave RLS untouched.
psql -X -v ON_ERROR_STOP=1 -d "$db" -f security/candidates/revoke_public_api_maintain.sql
psql -X -v ON_ERROR_STOP=1 -d "$db" -f security/candidates/revoke_public_api_maintain.sql
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
SET ROLE supabase_admin;
CREATE TABLE public.future_supabase_admin (id int);
RESET ROLE;
CREATE TABLE public.future_postgres (id int);
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['organizations','financial_records','future_supabase_admin','future_postgres'] LOOP
   IF has_table_privilege('anon','public.'||t,'MAINTAIN')
     OR has_table_privilege('authenticated','public.'||t,'MAINTAIN')
   THEN RAISE EXCEPTION 'API MAINTAIN persists on public.%',t; END IF;
 END LOOP;
 IF NOT has_table_privilege('service_role','public.financial_records','MAINTAIN')
   THEN RAISE EXCEPTION 'Candidate modified service_role MAINTAIN'; END IF;
 IF NOT has_table_privilege('authenticated','isolated.unrelated','MAINTAIN')
   THEN RAISE EXCEPTION 'Candidate changed another schema'; END IF;
 IF NOT has_table_privilege('authenticated','public.financial_records','SELECT')
   OR NOT has_table_privilege('authenticated','public.financial_records','INSERT')
   OR NOT has_table_privilege('authenticated','public.financial_records','UPDATE')
   OR (SELECT NOT relrowsecurity FROM pg_class WHERE oid='public.financial_records'::regclass)
   THEN RAISE EXCEPTION 'Candidate weakened business access or RLS'; END IF;
END $$;
SQL
# Two synthetic organizations: own records visible, other tenant denied by RLS.
for pair in '11111111-1111-4111-8111-111111111111:100' '22222222-2222-4222-8222-222222222222:200'; do
  org="${pair%%:*}"; amount="${pair##*:}"
  actual="$(psql -X -At -v ON_ERROR_STOP=1 -d "$db" -c "SET ROLE authenticated; SELECT set_config('app.tenant_id','$org',false); SELECT string_agg(amount::text,',') FROM public.financial_records;")"
  [[ "${actual##*$'\n'}" == "$amount" ]] || { echo "RLS tenant leak for $org"; exit 1; }
done
psql -X -v ON_ERROR_STOP=1 -d "$db" -c "SET ROLE authenticated; SELECT set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',false); INSERT INTO public.financial_records VALUES (3,'11111111-1111-4111-8111-111111111111',300);"
if psql -X -v ON_ERROR_STOP=1 -d "$db" -c "SET ROLE authenticated; SELECT set_config('app.tenant_id','11111111-1111-4111-8111-111111111111',false); INSERT INTO public.financial_records VALUES (4,'22222222-2222-4222-8222-222222222222',400);" > /tmp/jco-maintain-deny.log 2>&1; then
  echo 'Cross-tenant INSERT unexpectedly allowed'; exit 1
fi
grep -qi 'row-level security policy' /tmp/jco-maintain-deny.log
if psql -X -v ON_ERROR_STOP=1 -d "$db" -c "SET ROLE anon; SELECT * FROM public.financial_records" > /tmp/jco-maintain-deny.log 2>&1; then
  echo 'Anonymous SELECT unexpectedly allowed'; exit 1
fi
grep -qi 'permission denied' /tmp/jco-maintain-deny.log
echo 'PASS: PostgreSQL 17 MAINTAIN revocation; current/future tables; two-tenant RLS; CRUD; service_role; schema scope.'
