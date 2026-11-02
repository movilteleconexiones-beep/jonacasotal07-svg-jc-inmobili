import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  REVIEWED_FINANCE_MIGRATIONS, KNOWN_DUPLICATE_VERSIONS,
  gitBlobSha, inspectAppliedFinanceVersions,
  inspectFullMigrationLedger, verifyRepositoryFinanceHistory,
} from '../scripts/ops/finance-migration-gate.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations=join(root,'supabase/migrations');
const files=readdirSync(migrations);
const reviewed=REVIEWED_FINANCE_MIGRATIONS.map((item)=>item.version);
const consolidated=['20261012070133','20261012071309'];
const allDated=[...new Set(files.map((name)=>/^(\d{14})_[^.]+\.sql$/.exec(name)?.[1]).filter(Boolean))];

test('pinned historical finance migrations cannot change unnoticed',()=>{
  const result=verifyRepositoryFinanceHistory(migrations);
  assert.equal(result.ok,true,result.problems.join('; '));
  assert.equal(reviewed.length,5);
  assert.deepEqual(Object.keys(KNOWN_DUPLICATE_VERSIONS),['20261013040000']);
  for(const item of REVIEWED_FINANCE_MIGRATIONS)
    assert.equal(gitBlobSha(readFileSync(join(migrations,item.filename))),item.blob);
});

test('production consolidated finance versions do not authorize unreviewed db push',()=>{
  const result=inspectAppliedFinanceVersions(consolidated);
  assert.equal(result.consolidatedPresent,true);
  assert.equal(result.safeToPush,false);
  assert.deepEqual(result.missing,reviewed);
  assert.equal(inspectAppliedFinanceVersions([...consolidated,...reviewed]).safeToPush,true);
});

test('whole repository ledger must match before any migration apply',()=>{
  const result=inspectFullMigrationLedger([...consolidated,...reviewed],files);
  assert.equal(result.safeToPush,false);
  assert.ok(result.totalLocalTimestamped>=70);
  assert.ok(result.missing.length>=60);
  assert.equal(inspectFullMigrationLedger([...consolidated,...allDated],files).safeToPush,true);
  assert.throws(()=>inspectFullMigrationLedger(['invalid'],files),/Invalid migration ledger version/);
  assert.throws(()=>inspectAppliedFinanceVersions({}),/JSON array/);
});
