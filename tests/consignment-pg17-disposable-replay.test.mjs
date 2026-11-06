import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const replay=read('security/tests/consignment_local_ddl_replay_pg17.sh');
const fixture=read('security/tests/consignment_local_ddl_replay_fixture.sql');
const check=read('security/checks/consignment_restore_shape_fingerprint.sql');
const local=read('supabase/migrations/20261010212630_property_consignment_intake.sql');

test('only the first two historical consignment CREATE TABLE definitions are replayed',()=>{
  assert.equal((local.match(/^create table private\.property_intake_sites /gm)??[]).length,1);
  assert.equal((local.match(/^create table public\.property_consignments /gm)??[]).length,1);
  assert.equal((local.match(/^-- This old policy exposed/gm)??[]).length,1);
  assert.ok(local.indexOf('create table private.property_intake_sites') <
    local.indexOf('create table public.property_consignments'));
  assert.ok(local.indexOf('create table public.property_consignments') <
    local.indexOf('-- This old policy exposed'));
  assert.match(replay,/src=supabase\/migrations\/20261010212630_property_consignment_intake\.sql/);
  assert.match(replay,/awk '\/\^-- This old policy exposed\/\{exit\} \{print\} END\{print "COMMIT;"\}'/);
  assert.doesNotMatch(replay,/psql[^\n]+-f\s+"?\$src"?/);
  assert.doesNotMatch(replay,/migration repair|db push/i);
});

test('the replay is confined to an isolated disposable PostgreSQL 17 CI environment',()=>{
  assert.match(replay,/\$\{CI:-\}/);
  assert.match(replay,/\$\{GITHUB_ACTIONS:-\}/);
  assert.match(replay,/RUNNER_TEMP/);
  assert.match(replay,/db=jco_consignment_ddl_replay_test/);
  assert.match(replay,/existing_db.*psql_cmd/s);
  assert.match(replay,/existing_roles.*psql_cmd/s);
  assert.match(replay,/existing_db.*"0".*existing_roles.*"0"/s);
  assert.match(replay,/CREATE DATABASE \$db/);
  assert.match(replay,/DROP DATABASE IF EXISTS \$db WITH \(FORCE\)/);
  assert.match(replay,/DROP ROLE IF EXISTS anon, authenticated, service_role/);
  assert.match(replay,/mktemp -d/);
  assert.match(replay,/trap cleanup EXIT/);
  assert.match(replay,/owned_db=true/);
  assert.match(replay,/owned_roles=true/);
  assert.match(fixture,/CREATE TABLE public\.organizations/);
  assert.match(fixture,/CREATE TABLE auth\.users/);
  assert.match(fixture,/CREATE FUNCTION public\.has_org_permission/);
  assert.doesNotMatch(fixture,/INSERT INTO public\.property_consignments/i);
});

test('physical schema fingerprints pin both live entities without testing mutable RLS chronology',()=>{
  for (const name of ['private.property_intake_sites','public.property_consignments']) {
    assert.ok(check.includes("'"+name+"'"),'Missing current live schema baseline '+name);
    assert.ok(replay.includes(name),'Replay must check actual table '+name);
  }
  assert.match(check,/actual_cols_sha=columns_sha256/);
  assert.match(check,/actual_constraints_sha=constraints_sha256/);
  assert.match(check,/actual_indexes_sha=indexes_sha256/);
  assert.match(check,/actual_policies_sha=policies_sha256/);
  assert.match(check,/actual_triggers_sha=triggers_sha256/);
  assert.match(check,/has_table_privilege\('anon',oid,'SELECT'\)/);
  assert.match(replay,/\$2 == "COLUMNS"/);
  assert.match(replay,/\$2 == "CONSTRAINTS"/);
  assert.match(replay,/\$2 == "INDEXES"/);
  assert.match(replay,/checked != 6 \|\| bad != 0/);
  assert.match(replay,/unexpected_historical_drift/);
  assert.match(replay,/public\.property_consignments\|COLUMNS\|DRIFT/);
  assert.match(check,/READ-ONLY/);
});

test('read-only SELECT remains a catalog reference, never a mutation recipe',()=>{
  assert.ok(check.trimEnd().endsWith('ORDER BY identifier,component;'));
  for(const statement of [
    /^\s*DROP\s+TABLE/im,
    /^\s*ALTER\s+TABLE/im,
    /^\s*UPDATE\s+public\./im,
    /^\s*DELETE\s+FROM/im,
  ])assert.doesNotMatch(check,statement);
  assert.doesNotMatch(check, /supabase_migrations\.schema_migrations/);
});
