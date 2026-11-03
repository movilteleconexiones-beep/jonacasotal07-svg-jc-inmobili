import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// This tests the actual workflow file that will be merged, not a sample YAML.
// GitHub's required check and Railway checkSuites must still be configured
// separately. A successful CI run is not the same thing as release approval.
test('main push and PR to main run the same full validation job', () => {
  const triggers = workflow.split(/^concurrency:\s*$/m)[0];
  assert.match(triggers, /^  pull_request:\s*\n    branches: \[main\]/m);
  assert.match(triggers, /^  push:\s*\n    branches: \[main\]/m);
  assert.match(triggers, /^  workflow_dispatch:\s*$/m);
  assert.match(workflow, /^  validate:\s*$/m);
  assert.match(workflow, /Main deployment CI and migration NO-GO contract regression/);
  for (const name of [
    'npm audit security gate',
    'Migration lineage classification',
    'Private rent receipt evidence SQL tenant isolation',
    'External portal RLS, customer privacy',
  ]) assert.ok(workflow.includes(name), 'Missing release-critical check: ' + name);
  assert.match(workflow, /group: inmojco-ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/);
});

test('normal package build and workflow never push or repair migrations', () => {
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    assert.doesNotMatch(command, /\bsupabase\s+(?:db\s+push|migration\s+repair)\b/i, name);
    assert.doesNotMatch(command, /\b(?:psql|pg_restore)\b/i, name);
  }
  assert.doesNotMatch(workflow, /^\s*(?:sudo\s+)?supabase\s+(?:db\s+push|migration\s+repair)\b/im);
  assert.doesNotMatch(workflow, /^\s*(?:sudo\s+)?npx\s+supabase\s+(?:db\s+push|migration\s+repair)\b/im);
});

test('production migration ledger still FAILS CLOSED: CI green does not imply release GO', () => {
  const tool = join(root, 'scripts/ops/finance-migration-gate.mjs');
  const snapshot = join(root, 'docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json');
  const check = spawnSync(process.execPath, [tool, '--ledger', snapshot], {
    cwd: root, encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(check.status, 2, 'Production migration drift must not silently authorize db push');
  assert.match(check.stderr, /NO-GO:/);
  assert.match(check.stderr, /Do not run db push/);
  assert.match(check.stderr, /Legacy SQL files/);
});
