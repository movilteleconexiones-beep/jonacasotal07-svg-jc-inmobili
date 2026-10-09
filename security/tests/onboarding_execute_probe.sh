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
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 >/tmp/jco_onboarding_anon_$$.log 2>&1 <<'SQL'
SET ROLE anon;
SELECT public.onboarding_execute_probe('Demo','demo','CO');
SQL
status=$?
set -e
log=/tmp/jco_onboarding_anon_$$.log
trap 'rm -f "$log"' EXIT
if [[ "$status" -eq 0 ]] || ! grep -q 'permission denied for function onboarding_execute_probe' "$log"; then
 cat "$log" >&2
 echo 'FAIL: anonymous function execution was not denied' >&2
 exit 1
fi
echo 'PASS: authenticated EXECUTE allowed; anonymous EXECUTE denied'
