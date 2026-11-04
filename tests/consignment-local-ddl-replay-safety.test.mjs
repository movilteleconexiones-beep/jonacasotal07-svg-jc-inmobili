import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root,
  'security/tests/consignment_local_ddl_replay_pg17.sh'), 'utf8');

function verifySafeLocalReplay(script) {
  assert.match(script, /^#!\/usr\/bin\/env bash/);
  assert.match(script, /^set -euo pipefail$/m);
  assert.match(script, /\$\{CI:-\}.*"true"/);
  assert.match(script, /\$\{GITHUB_ACTIONS:-\}.*"true"/);
  assert.match(script, /\$\{RUNNER_TEMP:-\}/);
  assert.match(script, /psql -X -v ON_ERROR_STOP=1 -h localhost -U postgres/);
  assert.match(script, /SELECT count\(\*\) FROM pg_database WHERE datname='\$db'/);
  assert.match(script, /SELECT count\(\*\) FROM pg_roles WHERE rolname IN \('anon','authenticated','service_role'\)/);
  assert.match(script, /if \[\[ "\$existing_db" != "0" \|\| "\$existing_roles" != "0" \]\]/);
  assert.match(script, /Refusing to touch a preexisting DB or anon\/authenticated\/service_role roles/);
  assert.match(script, /mktemp -d "\$RUNNER_TEMP\/consignment-ddl\.XXXXXX"/);
  assert.match(script, /owned_db=false/);
  assert.match(script, /owned_roles=false/);
  assert.match(script, /if \[\[ "\$owned_db" == true \]\]/);
  assert.match(script, /if \[\[ "\$owned_roles" == true \]\]/);
  assert.match(script, /DROP DATABASE IF EXISTS \$db WITH \(FORCE\)/);
  assert.match(script, /DROP ROLE IF EXISTS anon, authenticated, service_role/);
  assert.match(script, /rm -rf -- "\$workdir"/);
  assert.match(script, /awk '\/\^-- This old policy exposed\/{exit}/);
  assert.match(script, /if \(checked != 6 \|\| bad != 0\) exit 1/);
  assert.match(script, /unexpected_historical_drift boolean/);
  assert.match(script, /grep -Fxq 'public\.property_consignments\|COLUMNS\|DRIFT'/);
  // No cleanup handler or destructive call may be installed before checking
  // that both database and shared API roles are absent.
  const preflight = script.indexOf('if [[ "$existing_db" != "0"');
  const trap = script.indexOf('trap cleanup EXIT');
  const makeDb = script.indexOf('"CREATE DATABASE $db"');
  assert.ok(preflight >= 0 && trap > preflight && makeDb > trap);
  assert.doesNotMatch(script, /\bsupabase\s+(?:db\s+push|migration\s+repair)\b/i);
  return script;
}

test('isolated consignment replay must refuse production/preexisting PG17 resources', () => {
  verifySafeLocalReplay(src);
});

test('replay refuses removal of either safety gate or unrestricted role deletion', () => {
  const variants = [
    src.replace('${GITHUB_ACTIONS:-}', '${NOT_GITHUB_ACTIONS:-}'),
    src.replace('-h localhost -U postgres', '-h production.example -U postgres'),
    src.replace('if [[ "$existing_db" != "0" || "$existing_roles" != "0" ]]',
      'if [[ "$existing_db" != "0" ]]'),
    src.replace('if [[ "$owned_roles" == true ]]', 'if true; then'),
    src.replace('if [[ "$owned_db" == true ]]', 'if true; then'),
    src.replace('mktemp -d "$RUNNER_TEMP/consignment-ddl.XXXXXX"', 'workdir="/tmp"'),
    src.replace('if (checked != 6 || bad != 0) exit 1','if (checked == 6 || bad == 0) exit 0'),
  ];
  for (const variant of variants) {
    assert.notEqual(variant, src, 'Each test must mutate the actual shell source');
    assert.throws(() => verifySafeLocalReplay(variant));
  }
});
