import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { buildMigrationLineage } from '../scripts/ops/migration-lineage-audit.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations=join(root,'supabase/migrations');
const ledger=join(root,'docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json');
const payload=JSON.parse(readFileSync(ledger,'utf8'));
const local=readdirSync(migrations);
const report=buildMigrationLineage(local,payload.migrations);

test('read-only historical snapshot quantifies all 109 SQL files against 99 applied rows',()=>{
  assert.equal(report.summary.local_files,109);
  assert.equal(report.summary.applied_migrations,99);
  assert.equal(report.summary['exact-version-and-name'],1);
  assert.equal(report.summary['retimed-name-match-only'],60);
  assert.equal(report.summary['legacy-name-match-only'],25);
  assert.equal(report.summary['unmatched-local-name'],16);
  assert.equal(report.summary['unapplied-legacy-draft'],7);
  assert.equal(report.summary.applied_without_local_name,13);
  assert.equal(report.summary.duplicate_local_versions,1);
  assert.deepEqual(report.version_collisions[0].filenames,[
    '20261013040000_commission_recording_corrections.sql',
    '20261013040000_commission_safe_edit_and_paid_review.sql',
  ]);
  assert.equal(report.sql_equivalence_verified,false);
  assert.equal(report.migration_push_authorized,false);
});

test('seven unpublished 0026–0032 billing draft files stay quarantined',()=>{
  const actual=report.results.filter(r=>r.classification==='unapplied-legacy-draft');
  assert.deepEqual(actual.map(r=>r.version),['0026','0027','0028','0029','0030','0031','0032']);
  assert.ok(actual.every(r=>r.candidates.length===0));
  assert.ok(report.applied_without_local_name.some(x=>x.name==='0026_rental_management_core'));
  assert.ok(report.applied_without_local_name.some(x=>x.name==='audited_rent_receipts_owner_deductions_finance_permissions'));
});

test('retimed name is a lead only; it never certifies SQL or permissions',()=>{
  const x=report.results.find(r=>r.filename==='20261014030000_owner_payout_ledger.sql');
  assert.equal(x.classification,'retimed-name-match-only');
  assert.equal(x.candidates.length,1);
  assert.notEqual(x.version,x.candidates[0].version);
  assert.equal(report.sql_equivalence_verified,false);
});

test('synthetic collisions, corrupt metadata and ambiguous ledger are rejected or surfaced',()=>{
  assert.throws(()=>buildMigrationLineage(['0010_a.sql'],[{version:'bad',name:'0010_a'}]),/Invalid applied/);
  assert.throws(()=>buildMigrationLineage(['0010_a.sql'],[
    {version:'20261001000000',name:'0010_a'},
    {version:'20261001000000',name:'0010_b'},
  ]),/Duplicate applied version/);
  assert.throws(()=>buildMigrationLineage(['random.sql'],[]),/Unexpected migration/);
  assert.throws(()=>buildMigrationLineage(['0010_a.sql','0010_a.sql'],[]),/Duplicate local filename/);
  const ambiguous=buildMigrationLineage(['0010_a.sql'],[
    {version:'20261001000000',name:'0010_a'},
    {version:'20261001000001',name:'0010_a'},
  ]);
  assert.equal(ambiguous.results[0].classification,'ambiguous-applied-name');
  assert.equal(ambiguous.migration_push_authorized,false);
});

test('CLI is read-only, emits NO-GO and refuses mutation options',()=>{
  const script=join(root,'scripts/ops/migration-lineage-audit.mjs');
  const normal=spawnSync(process.execPath,[script,'--ledger',ledger],{cwd:root,encoding:'utf8'});
  assert.equal(normal.status,0,normal.stderr);
  assert.match(normal.stdout,/NO-GO/);
  assert.match(normal.stdout,/unapplied-legacy-draft: 7/);
  const bad=spawnSync(process.execPath,[script,'--ledger',ledger,'--apply'],{cwd:root,encoding:'utf8'});
  assert.equal(bad.status,2);
  assert.match(bad.stderr,/Refusing unknown or mutation arguments/);
});

test('CLI fails closed for unrecognized flags, repeated ledger and positional extras',()=>{
  const script=join(root,'scripts/ops/migration-lineage-audit.mjs');
  const cases=[
    ['--ledger',ledger,'--db-push'],
    ['--ledger',ledger,'--write'],
    ['--ledger',ledger,'--force'],
    ['--ledger',ledger,'unexpected.sql'],
    ['--ledger',ledger,'--ledger',ledger],
    ['--ledger',ledger,'--json','--json'],
    ['--ledger','--json'],
  ];
  for(const args of cases){
    const run=spawnSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8'});
    assert.equal(run.status,2,JSON.stringify({args,stdout:run.stdout,stderr:run.stderr}));
    assert.match(run.stderr,/Usage:|Refusing/);
    assert.equal(run.stdout,'');
  }
  const valid=spawnSync(process.execPath,[script,'--json','--ledger',ledger],{cwd:root,encoding:'utf8'});
  assert.equal(valid.status,0,valid.stderr);
  assert.equal(JSON.parse(valid.stdout).migration_push_authorized,false);
});
