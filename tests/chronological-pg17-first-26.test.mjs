import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = p => readFileSync(new URL('../'+p, import.meta.url),'utf8');
const script=read('security/tests/chronological_pg17_first_26.sh');
const fixture=read('security/tests/chronological_pg17_auth_stub.sql');
test('#104: first original 26/99 replay is CI-only with localhost PG17 and no tenant copy',()=>{
 assert.match(script,/GITHUB_ACTIONS/);
 assert.match(script,/RUNNER_TEMP/);
 assert.match(script,/server_version_num/);
 assert.match(script,/jco_migration_104_replay_test/);
 assert.match(script,/existing_db.*existing_roles/s);
 assert.match(script,/CREATE DATABASE \$db/);
 assert.match(script,/DROP DATABASE IF EXISTS \$db WITH \(FORCE\)/);
 assert.match(script,/DROP ROLE IF EXISTS anon,authenticated,service_role/);
 assert.match(script,/trap cleanup EXIT/);
 assert.match(script,/reconstruct-applied-99\.mjs --archive-temporary/);
 assert.match(script,/m\.summaries\.slice\(0,26\)/);
 assert.match(script,/if \[\[ "\$\{#candidates\[@\]\}" != 26 \]\]/);
 assert.match(script,/PG17 isolated chronological replay PASS/);
 assert.match(script,/remaining 73 NOT certified/);
});
test('#104: negative refusal is prior to any database ownership or fixture creation',()=>{
 const initial=script.indexOf('existing_db=');
 const fixed=script.indexOf('CREATE DATABASE $db');
 const network=script.indexOf('psql_cmd=(psql -X -v ON_ERROR_STOP=1 -h localhost -U postgres)');
 assert.ok(network>=0&&initial>network&&fixed>initial);
 assert.ok(script.indexOf('if [[ "$existing_db" != "0" || "$existing_roles" != "0" ]]')<fixed);
 assert.doesNotMatch(script,/supabase\s+db|migration repair|SUPABASE_DB_URL|DATABASE_URL/);
 assert.doesNotMatch(script,/--dbname=|--host=|psql\s+-h\s+\$\{/);
});
test('#104: Auth stub is explicit, not a claim of full Auth/Storage restoration',()=>{
 assert.match(fixture,/CREATE ROLE anon NOLOGIN/);
 assert.match(fixture,/CREATE ROLE authenticated NOLOGIN/);
 assert.match(fixture,/CREATE TABLE auth\.users/);
 assert.match(fixture,/CREATE FUNCTION auth\.uid\(\)/);
 assert.doesNotMatch(fixture,/INSERT INTO\s+(?:auth|public)\./i);
 assert.doesNotMatch(fixture,/CREATE EXTENSION\s+.*(?:http|dblink|postgres_fdw)/i);
});
test('#104: observe eight real tables and RLS in PostgreSQL, never trust SQL command exit only',()=>{
 assert.match(script,/expected physical tables/);
 assert.match(script,/expected tenant RLS tables enabled/);
 assert.match(script,/FROM auth\.users/);
 assert.match(script,/\[\[ "\$account_count" == "0" \]\]/);
 assert.match(script,/exit 1/);
});
