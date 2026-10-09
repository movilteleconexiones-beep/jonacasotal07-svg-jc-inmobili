#!/usr/bin/env bash
set -euo pipefail
: "${DB_URL:?DB_URL must be disposable PostgreSQL}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/tests/atomic_order_fixture.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE public.roles(id uuid PRIMARY KEY,organization_id uuid REFERENCES public.organizations(id),active boolean DEFAULT true);
INSERT INTO public.roles VALUES
 ('77777777-7777-4777-8777-777777777777','33333333-3333-4333-8333-333333333333',true),
 ('88888888-8888-4888-8888-888888888888','22222222-2222-4222-8222-222222222222',true);
CREATE OR REPLACE FUNCTION public.has_org_permission(target_org uuid,permission_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT target_org='22222222-2222-4222-8222-222222222222'::uuid
 AND permission_key='roles.assign'
 AND auth.uid()='44444444-4444-4444-8444-444444444444'::uuid
$$;
ALTER TABLE public.member_roles ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON public.organization_members TO authenticated;
GRANT INSERT,SELECT ON public.member_roles TO authenticated;
SQL
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/experiments/member_role_tenant_rls_candidate.sql
# Same-tenant role accepted.
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
INSERT INTO public.member_roles VALUES
 ('55555555-5555-4555-8555-555555555555','88888888-8888-4888-8888-888888888888');
RESET ROLE;
SQL
# Cross-tenant role must be rejected specifically by RLS.
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 > /tmp/jco_rls_reject_$$.log 2>&1 <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
INSERT INTO public.member_roles VALUES
 ('55555555-5555-4555-8555-555555555555','77777777-7777-4777-8777-777777777777');
SQL
status=$?
set -e
log="/tmp/jco_rls_reject_$$.log"
trap 'rm -f "$log"' EXIT
if [[ "$status" == 0 ]] || ! grep -q 'violates row-level security policy' "$log"; then
 cat "$log" >&2
 echo "FAIL: foreign role was not specifically rejected by RLS" >&2
 exit 1
fi
echo "PASS: own-tenant role accepted; foreign-tenant role rejected by RLS"
