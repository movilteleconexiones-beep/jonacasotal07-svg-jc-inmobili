import assert from 'node:assert/strict';
import {readFileSync,readdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {gitBlobSha} from '../scripts/ops/finance-migration-gate.mjs';
import {
  materializeAppliedBody, buildHistoricalArchive, buildPinnedHistoricalArchive,
  writeDisposableArchive,
} from '../scripts/ops/reconstruct-applied-99.mjs';

const read = x => JSON.parse(readFileSync(new URL('../'+x,import.meta.url),'utf8'));
const manifest=read('docs/ops/snapshots/migration-source-parity-2026-11-06.json');
const ledger=read('docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json');

test('#104: all 99 original SQL bodies are restored byte-for-byte, in the actual applied order',()=>{
 const archive=buildPinnedHistoricalArchive();
 assert.equal(archive.ok,true);
 assert.equal(archive.count,99);
 assert.equal(archive.bytes,493999);
 assert.deepEqual([archive.safeToPush,archive.safeToRepair,archive.safeToReplay],[false,false,false]);
 assert.deepEqual(archive.bodies.map(b=>b.version),ledger.migrations.map(m=>m.version));
 assert.equal(archive.bodies.reduce((a,b)=>a+b.bytes,0),493999);
 for(const body of archive.bodies){
  assert.equal(gitBlobSha(body.sql),body.sha,body.version);
  assert.equal(Buffer.byteLength(body.sql,'utf8'),body.bytes,body.version);
 }
});

test('#104: 5 previously non-byte-exact sources are archived, not silently normalized',()=>{
 const archive=buildPinnedHistoricalArchive();
 const mapped=new Map(archive.bodies.map(x=>[x.version,x]));
 const categories=manifest.records.filter(x=>!['EXACT','EXACT_HISTORIC_ALIAS'].includes(x.category));
 assert.equal(categories.length,5);
 for(const r of categories){
  assert.equal(mapped.get(r.version).sha,r.appliedSqlGitBlob);
  assert.equal(mapped.get(r.version).bytes,r.appliedSqlBytes);
  assert.equal(mapped.get(r.version).sql,materializeAppliedBody(r));
 }
 const leading=mapped.get('20261005053050').sql;
 assert.ok(leading.startsWith('\n'));
 const trailing=mapped.get('20261011002448').sql;
 assert.ok(!trailing.endsWith('\n'));
 const consolidated=mapped.get('20261012070133');
 assert.equal(consolidated.bytes,28005);
});

test('#104: byte or identity tampering stops archive generation; never allows migration repair',()=>{
 const corrupts=[
  x=>x.records[0].appliedSqlGitBlob='0'.repeat(40),
  x=>x.records[0].appliedSqlBytes++,
  x=>x.records[0].localPath='../../../tmp/private.sql',
  x=>x.records[0].category='REVIEWED_NONEXECUTABLE_DIFFERENCE',
  x=>x.records[1].version=x.records[0].version,
  x=>x.safeToPush=true,
 ];
 for(const change of corrupts){
  const m=structuredClone(manifest);change(m);
  assert.throws(()=>buildHistoricalArchive(m,ledger),undefined,change.toString());
 }
 const tamper=structuredClone(ledger);
 tamper.migrations.reverse();
 assert.throws(()=>buildHistoricalArchive(manifest,tamper),/chronological/);
 const extra=structuredClone(ledger);
 extra.migrations[0].name='wrong_applied_name';
 assert.throws(()=>buildHistoricalArchive(manifest,extra),/no pinned SQL/);
});

test('#104: optional archive creates only private SQL text in OS temp with hash checks',()=>{
 const archive=buildPinnedHistoricalArchive();
 const out=writeDisposableArchive(archive);
 try{
  assert.equal(out.count,99);
  assert.equal(out.bytes,493999);
  assert.equal(out.safeToPush,false);
  assert.ok(out.path.startsWith(resolve(tmpdir())+'/'));
  assert.ok(!out.path.includes('/supabase/migrations'));
  const files=readdirSync(join(out.path,'readonly-sql'));
  assert.equal(files.length,99);
  assert.ok(files.every(name=>/^\d{14}_[a-z0-9_]+\.sql\.txt$/.test(name)));
  assert.ok(!files.includes('20261010222700_commercial_plan_permissions.sql.txt'));
  const index=readFileSync(join(out.path,'MANIFEST.json'),'utf8');
  const manifestIndex=JSON.parse(index);
  assert.deepEqual([manifestIndex.safeToPush,manifestIndex.safeToRepair,manifestIndex.safeToReplay],
   [false,false,false]);
  assert.equal(manifestIndex.summaries.length,99);
  const item=manifestIndex.summaries.find(m=>m.version==='20261012070133');
  assert.ok(item);
  assert.equal(gitBlobSha(readFileSync(join(out.path,'readonly-sql',item.filename))),item.sha);
 } finally {
  rmSync(out.path,{recursive:true,force:true});
 }
});

test('#104: commands cannot connect to Supabase or execute archived SQL',()=>{
 const src=readFileSync(new URL('../scripts/ops/reconstruct-applied-99.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/child_process|execSync|spawnSync|psql\s|db push\s|migration repair\s/);
 assert.doesNotMatch(src,/SUPABASE_DB_URL|PGPASSWORD|POSTGRES_PASSWORD|SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(src,/mkdtempSync\(join\(tmpdir\(\)/);
 assert.match(src,/\.sql\.txt/);
 assert.match(src,/safeToPush:false,safeToRepair:false,safeToReplay:false/);
});
