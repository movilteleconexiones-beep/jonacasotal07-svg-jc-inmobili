import assert from 'node:assert/strict';
import { HARDENING_SOURCE, FINANCE_CONSOLIDATION, stripDocumentationOnly, verifyAppliedHardeningSource, reconstructAppliedConsolidation, verifyAppliedConsolidation } from '../scripts/ops/finance-hardening-provenance.mjs';
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
  const fullyDated = inspectFullMigrationLedger([...consolidated,...allDated],files);
  assert.equal(fullyDated.versionAlignmentComplete,true);
  assert.equal(fullyDated.safeToPush,false, 'legacy SQL files, including seven unpublished billing drafts, prohibit db push');
  assert.equal(fullyDated.legacySqlFiles.length,32);
  assert.equal(inspectFullMigrationLedger(['20261012120000'],['20261012120000_test.sql']).safeToPush,true);
  assert.equal(inspectFullMigrationLedger(['20261012120000'],['20261012120000_test.sql','0032_atomic_sandbox_payment_order_draft.sql']).safeToPush,false);
  assert.throws(()=>inspectFullMigrationLedger(['invalid'],files),/Invalid migration ledger version/);
  assert.throws(()=>inspectAppliedFinanceVersions({}),/JSON array/);
});


test('20261012071309 applied SQL equals the 20261012150000 local hardening body', () => {
  const sql=readFileSync(join(migrations, '20261012150000_finance_approval_and_audit_timestamp_hardening.sql'),'utf8');
  const report=verifyAppliedHardeningSource(sql);
  assert.equal(report.matchesRecordedSql,true,JSON.stringify(report));
  assert.equal(report.releaseAllowed,false);
  assert.equal(report.bytes,889);
  assert.equal(report.lines,24);
  assert.equal(report.sha256,HARDENING_SOURCE.sha256);
  // Comments and blank lines are non-executable and must not affect provenance.
  assert.equal(verifyAppliedHardeningSource('-- audit annotation\n\n'+sql).matchesRecordedSql,true);
  assert.equal(stripDocumentationOnly(sql).includes('CREATE TRIGGER aaa_owner_deductions_server_timestamps'),true);
});

test('finance hardening provenance fails closed on altered policy, grants and trigger', () => {
  const sql=readFileSync(join(migrations, '20261012150000_finance_approval_and_audit_timestamp_hardening.sql'),'utf8');
  const alterations=[
    sql.replace("status = 'DRAFT'","status = 'ACTIVE'"),
    sql.replace('REVOKE ALL ON FUNCTION','GRANT ALL ON FUNCTION'),
    sql.replace('CREATE TRIGGER aaa_owner_deductions_server_timestamps','-- removed trigger'),
    sql+'\nSELECT 1;',
  ];
  for(const changed of alterations) {
    assert.notEqual(changed,sql);
    const result=verifyAppliedHardeningSource(changed);
    assert.equal(result.matchesRecordedSql,false,'Mutated original SQL must not match production ledger');
    assert.equal(result.releaseAllowed,false);
  }
  assert.throws(()=>stripDocumentationOnly(null),/SQL source/);
});

test('20261012070133 SQL has exactly the four original finance migration bodies in order', () => {
  const sources=FINANCE_CONSOLIDATION.localFiles.map((name)=>
    readFileSync(join(migrations,name),'utf8'));
  const sql=reconstructAppliedConsolidation(sources);
  const result=verifyAppliedConsolidation(sources);
  assert.equal(result.matchesRecordedSql,true,JSON.stringify(result));
  assert.equal(result.bytes,24924);
  assert.equal(result.lines,484);
  assert.equal(result.sha256,FINANCE_CONSOLIDATION.normalizedSha256);
  assert.equal(result.releaseAllowed,false);
  assert.ok(sql.startsWith("BEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='120s';\n"));
  assert.ok(sql.endsWith("\nNOTIFY pgrst, 'reload schema';\nCOMMIT;"));
  assert.equal(verifyAppliedConsolidation(sources.map(x=>'-- evidence annotation\n'+x)).matchesRecordedSql,true);
});

test('four finance originals must not drift, reorder, or change transaction boundaries', () => {
  const sources=FINANCE_CONSOLIDATION.localFiles.map((name)=>
    readFileSync(join(migrations,name),'utf8'));
  assert.equal(verifyAppliedConsolidation([...sources].reverse()).matchesRecordedSql,false);
  const extra=[...sources];
  extra[0]=extra[0].replace('COMMIT;',"SELECT 1;\nCOMMIT;");
  assert.notEqual(extra[0],sources[0]);
  assert.equal(verifyAppliedConsolidation(extra).matchesRecordedSql,false);
  const missingBoundary=[...sources];
  missingBoundary[1]=missingBoundary[1].replace('BEGIN;','-- transaction missing');
  assert.throws(()=>reconstructAppliedConsolidation(missingBoundary),/transaction boundary/);
  assert.throws(()=>reconstructAppliedConsolidation(sources.slice(1)),/Exactly four/);
});
