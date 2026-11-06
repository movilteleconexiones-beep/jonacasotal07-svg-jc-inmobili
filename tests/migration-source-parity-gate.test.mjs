import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  EXPECTED_CATEGORIES, verifyMigrationSourceParity, verifyPinnedMigrationSources,
} from '../scripts/ops/migration-source-parity-gate.mjs';

const read = (filename) => JSON.parse(readFileSync(new URL('../' + filename, import.meta.url), 'utf8'));
const original = read('docs/ops/snapshots/migration-source-parity-2026-11-06.json');
const ledger = read('docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json');
const clone = () => structuredClone(original);

test('all 99 original production migration bodies have pinned provenance and no release approval', () => {
  const result = verifyPinnedMigrationSources();
  assert.equal(result.ok, true, result.problems.join('; '));
  assert.equal(result.checked, 99);
  assert.equal(result.safeToPush, false);
  assert.deepEqual(result.counts, EXPECTED_CATEGORIES);
  assert.equal(original.repositoryMainSha, '9a8de6a4e1587bd31477c50a58e0d9892b95c01d');
  assert.equal(original.safeToPush, false);
  assert.equal(ledger.migrations.length, 99);
  assert.equal(original.records.length, 99);
});

test('historic finance consolidation and 0026/consignment originals are not guessed from same name', () => {
  const byVersion = Object.fromEntries(original.records.map(r => [r.version,r]));
  assert.equal(byVersion['20261012070133'].category, 'RECONSTRUCTED_FINANCE_4_FILES');
  assert.equal(byVersion['20261005153559'].category, 'EXACT_HISTORIC_ALIAS');
  assert.match(byVersion['20261005153559'].localPath, /docs\/ops\/snapshots\/0026_/);
  for (const version of ['20261010232928','20261010232930'])
    assert.match(byVersion[version].localPath,/docs\/ops\/snapshots\/.*applied-preflight\.sql/);
  assert.equal(byVersion['20261029171601'].category,'REVIEWED_NONEXECUTABLE_DIFFERENCE');
});

test('reject changes to SQL hash, an applied name, version repetition or missing original', () => {
  for (const mutate of [
    x => { x.records[0].appliedSqlGitBlob = '0'.repeat(40); },
    x => { x.records[0].appliedName = 'wrong-name'; },
    x => { x.records[1].version = x.records[0].version; },
    x => { x.records.pop(); },
    x => { x.safeToPush = true; },
    x => { x.records[0].category = 'EXACT_HISTORIC_ALIAS'; },
    x => { x.records[0].localPath = '../private/password.txt'; },
    x => { x.records[0].localGitBlob = '0'.repeat(40); },
  ]) {
    const m=clone();
    mutate(m);
    const result=verifyMigrationSourceParity(m, ledger);
    assert.equal(result.ok,false,JSON.stringify(mutate.toString()));
    assert.equal(result.safeToPush,false);
  }
});

test('every source category always fails closed on privilege/DDL changes', () => {
  const versions = ['20261005053050','20261011002448','20261012071309',
    '20261012070133','20261029171601'];
  for (const version of versions) {
    const m=clone();
    const record=m.records.find(x=>x.version===version);
    if (record.localGitBlob) record.localGitBlob='f'.repeat(40);
    else record.localSources[0]='supabase/migrations/does_not_exist.sql';
    const result=verifyMigrationSourceParity(m,ledger);
    assert.equal(result.ok,false,version);
    assert.equal(result.safeToPush,false);
  }
});

test('a future restored ledger must be re-audited instead of being silently accepted',()=>{
  const future=structuredClone(ledger);
  future.migrations.push({version:'20261106010101',name:'hypothetical_payment_change'});
  const result=verifyMigrationSourceParity(original,future);
  assert.equal(result.ok,false);
  assert.equal(result.safeToPush,false);
});
