import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('the identical full application validation runs for PRs and pushes to main', () => {
  const on = workflow.split(/^concurrency:/m)[0];
  assert.match(on, /^on:\s*$/m);
  assert.match(on, /^  pull_request:\s*\n    branches: \[main\]$/m);
  assert.match(on, /^  push:\s*\n    branches: \[main\]$/m);
  assert.match(on, /^  workflow_dispatch:\s*$/m);
  assert.match(workflow, /^  validate:\s*$/m);
  assert.match(workflow, /^\s*group: inmojco-ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/m);
  assert.match(workflow, /^\s*cancel-in-progress: true$/m);
  for (const step of [
    'TypeScript validation', 'npm audit security gate', 'Wompi webhook handler regression tests',
    'Financial UI audited RPC release gate',
  ]) assert.ok(workflow.includes(step), 'Missing critical check: ' + step);
});

test('the app build, start scripts and CI do not mutate live Supabase schemas', () => {
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    assert.doesNotMatch(command, /\bsupabase\s+(?:db\s+push|migration\s+repair)\b/i, name);
    assert.doesNotMatch(command, /\bpsql\s/i, name);
  }
  assert.doesNotMatch(workflow, /^\s*(?:npx\s+)?supabase\s+(?:db\s+push|migration\s+repair)\b/im);
  assert.match(pkg.scripts?.build ?? '', /^vite build$/);
});

test('migration drift and Railway branch protection are not silently declared solved', () => {
  const runbook = readFileSync(join(root, 'docs/ops/main-ci-release-rollout.md'), 'utf8');
  assert.match(runbook, /#104/);
  assert.match(runbook, /checkSuites/);
  assert.match(runbook, /NO-GO/);
  assert.match(runbook, /main/);
  assert.match(runbook, /proteg/i);
});
