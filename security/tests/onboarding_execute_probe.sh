#!/usr/bin/env bash
set -euo pipefail
: "${DB_URL:?DB_URL must be disposable PostgreSQL}"
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
SQL
psql "$DB_URL" -v ON_ERROR_STOP=1 -f security/tests/onboarding_execute_probe_fixture.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
DO $$
BEGIN
 IF has_function_privilege('anon','public.onboarding_execute_probe(text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'FAIL: anonymous user has EXECUTE'; END IF;
 IF NOT has_function_privilege('authenticated','public.onboarding_execute_probe(text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'FAIL: authenticated user lacks EXECUTE'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
DO $$
BEGIN
 IF public.onboarding_execute_probe('Demo','demo','CO') <> 'demo'
 THEN RAISE EXCEPTION 'FAIL: authenticated call'; END IF;
END $$;
RESET ROLE;
SQL
# The authenticated database role without a JWT user must still be rejected.
uid_log=$(mktemp)
anon_log=$(mktemp)
trap 'rm -f "$uid_log" "$anon_log"' EXIT
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 >"$uid_log" 2>&1 <<'SQL'
SET ROLE authenticated;
SELECT public.onboarding_execute_probe('Demo','demo','CO');
SQL
uid_status=$?
set -e
if [[ "$uid_status" -eq 0 ]] || ! grep -q 'Authentication required' "$uid_log"; then
 cat "$uid_log" >&2
 echo 'FAIL: missing JWT user was not rejected' >&2
 exit 1
fi
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 >"$anon_log" 2>&1 <<'SQL'
SET ROLE anon;
SELECT public.onboarding_execute_probe('Demo','demo','CO');
SQL
status=$?
set -e
if [[ "$status" -eq 0 ]] || ! grep -q 'permission denied for function onboarding_execute_probe' "$anon_log"; then
 cat "$anon_log" >&2
 echo 'FAIL: anonymous function execution was not denied' >&2
 exit 1
fi
echo 'PASS: authenticated EXECUTE allowed; anonymous EXECUTE denied'
