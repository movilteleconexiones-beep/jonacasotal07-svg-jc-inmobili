import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkCutover,inspectCutover} from '../scripts/ops/migration104-cutover-gate.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const archiveDir=resolve(root,'docs/ops/archive/legacy-sql-20261107');
const canonicalDir=resolve(root,'supabase/migrations');
const json=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const inputs={
  manifest:json('docs/ops/snapshots/migration-source-parity-2026-11-06.json'),
  ledger:json('docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json'),
  archives:json('docs/ops/snapshots/legacy-sql-sha-2026-11-07.json'),
  canonicalFiles:readdirSync(canonicalDir),legacyFiles:readdirSync(archiveDir),
  getCanonical:n=>readFileSync(join(canonicalDir,n)),
  getLegacy:n=>readFileSync(join(archiveDir,n)),
};

test('#104 DRAFT cutover pins all 99 original applied SQL bodies and preserves 109 sources',()=>{
  const result=inspectCutover();
  assert.equal(result.ok,true,JSON.stringify(result.errors));
  assert.equal(result.canonicalCount,100);
  assert.equal(result.archivedSources,109);
  assert.equal(result.matchedRecordedSql,99);
  assert.equal(result.verifiedForward,1);
  assert.deepEqual([result.safeToPush,result.safeToRepair,result.readyToMerge],[false,false,false]);
});

test('#104 DRAFT cutover rejects altered canonical SQL and lost historical sources',()=>{
  const row=inputs.manifest.records[0];const name=row.version+'_'+row.appliedName+'.sql';
  const corrupt=checkCutover({...inputs,getCanonical:n=>n===name?Buffer.from('SELECT 1;'):inputs.getCanonical(n)});
  assert.equal(corrupt.ok,false);
  assert.match(corrupt.errors.join(';'),/Canonical body differs/);
  const forward='20261107072304_website_lead_reuse_event_consent.sql';
  const tamperedForward=checkCutover({...inputs,getCanonical:n=>n===forward?Buffer.from('SELECT 1;'):inputs.getCanonical(n)});
  assert.equal(tamperedForward.ok,false);
  assert.match(tamperedForward.errors.join(';'),/forward CRM migration differs/);
  const missing=checkCutover({...inputs,legacyFiles:inputs.legacyFiles.filter(n=>!n.endsWith('.sql'))});
  assert.equal(missing.ok,false);
  assert.match(missing.errors.join(';'),/archive incomplete/);
  const extra=checkCutover({...inputs,canonicalFiles:[...inputs.canonicalFiles,'20261010222700_commercial_plan_permissions.sql']});
  assert.equal(extra.ok,false);
  assert.match(extra.errors.join(';'),/canonical|Canonical|Unapplied/);
});

test('#104 permanent cutover inspector has NO DB credentials or migration actions',()=>{
  const src=readFileSync(new URL('../scripts/ops/migration104-cutover-gate.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(src,/\bchild_process\b|execSync|spawnSync|pg_restore|PGPASSWORD|SUPABASE_SERVICE_ROLE_KEY|migration repair/);
  assert.match(src,/readyToMerge:false/);
  assert.match(src,/safeToPush:false/);
});
