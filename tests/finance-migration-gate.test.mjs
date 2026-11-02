import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  KNOWN_DUPLICATE_VERSIONS, REVIEWED_FINANCE_MIGRATIONS,
  gitBlobSha, inspectAppliedFinanceVersions, verifyRepositoryFinanceHistory,
} from '../scripts/ops/finance-migration-gate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/ops/finance-migration-gate.mjs');
const migrations = join(root, 'supabase/migrations');
const consolidated = ['20261012070133', '20261012071309'];
const reviewed = REVIEWED_FINANCE_MIGRATIONS.map((item) => item.version);

test('historic financial migrations and known legacy collision remain pinned', () => {
  const report = verifyRepositoryFinanceHistory(migrations);
  assert.equal(report.ok, true, report.problems.join('; '));
  assert.equal(reviewed.length, 5);
  assert.deepEqual(Object.keys(KNOWN_DUPLICATE_VERSIONS), ['20261013040000']);
  for (const item of REVIEWED_FINANCE_MIGRATIONS) {
    assert.equal(gitBlobSha(readFileSync(join(migrations, item.filename))), item.blob);
  }
  assert.notEqual(gitBlobSha('ALTER TABLE public.leases DROP COLUMN organization_id;'),
    REVIEWED_FINANCE_MIGRATIONS[0].blob);
});

test('known live consolidated versions do NOT authorize a db push', () => {
  const result = inspectAppliedFinanceVersions(consolidated);
  assert.equal(result.consolidatedPresent, true);
  assert.equal(result.safeToPush, false);
  assert.deepEqual(result.missing, reviewed);
});

test('preflight rejects malformed ledger and requires all historic versions', () => {
  assert.throws(() => inspectAppliedFinanceVersions({ version:'bad' }), /JSON array/);
  assert.throws(() => inspectAppliedFinanceVersions(['20261012; DROP TABLE users']), /Invalid/);
  assert.equal(inspectAppliedFinanceVersions([...consolidated,...reviewed]).safeToPush, true);
});

test('CLI blocks drift without database access and accepts a purely synthetic complete ledger', () => {
  const dir=mkdtempSync(join(tmpdir(), 'inmojco-migration-gate-'));
  try {
    const ledger=join(dir, 'ledger.json');
    writeFileSync(ledger, JSON.stringify(consolidated));
    let run=spawnSync(process.execPath,[script,'--ledger',ledger],{cwd:root,encoding:'utf8'});
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr,/NO-GO:/);
    assert.match(run.stderr,/Do not run db push/);
    writeFileSync(ledger, JSON.stringify([...consolidated,...reviewed]));
    run=spawnSync(process.execPath,[script,'--ledger',ledger],{cwd:root,encoding:'utf8'});
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout,/does NOT prove live DDL equivalence/);
  } finally {
    rmSync(dir, {force:true, recursive:true});
  }
});
