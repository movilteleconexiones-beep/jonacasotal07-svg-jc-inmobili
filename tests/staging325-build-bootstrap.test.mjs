import assert from 'node:assert/strict';
import {readdirSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {buildCandidate325,writeDisposableCandidate325} from '../scripts/ops/staging325-build-bootstrap.mjs';
import {gitBlobSha} from '../scripts/ops/finance-migration-gate.mjs';

test('#325: preserve all 99 real migration IDs and hashes and insert 3 staging-only prerequisites',()=>{
 const c=buildCandidate325();
 assert.equal(c.ok,true);
 assert.equal(c.safeForProduction,false);
 assert.equal(c.productionLedgerUntouched,true);
 assert.equal(c.authenticOriginals,99);
 assert.equal(c.stagingOnly,3);
 assert.equal(c.forwardApplied,5);
 assert.equal(c.total,107);
 assert.deepEqual(c.all.filter(r=>r.kind==='STAGING_ONLY').map(r=>[r.version,r.before]),[
   ['20261010232920','20261010232928'],
   ['20261010232929','20261010232930'],
   ['20261031032349','20261031032350'],
 ]);
 assert.deepEqual(c.all.filter(r=>r.kind==='STAGING_ONLY').slice(0,2).map(r=>r.sha),[
   'e4b252f022cf76f5ad773060ff86d33c29ef564c',
   'e6cb9a3923328158a42c86644fb4a591df25eba9',
 ]);
 assert.equal(c.all.filter(r=>r.kind==='CANONICAL').length,99);
 const forwards=c.all.filter(r=>r.kind==='FORWARD_APPLIED');
 assert.deepEqual(forwards.map(r=>[r.version,r.sha]),[
   ['20261107072304','c9fdfccf55c2fd8d70da709dd50d1d56de3361d5'],
   ['20261107082410','258d3cba1a361ffd1b9b15be8d9b7828531d2f35'],
   ['20261107103505','feaffad1398f38cea024ba173828cf8af8a18bb5'],
   ['20261107115138','951f76a05d7b3466e67ed6a90a87fd38e40ba6b9'],
   ['20261107124207','135ff4e7593255a214223daeb5f4690bf1b51dcf'],
 ]);
 assert.equal(new Set(c.all.map(r=>r.version)).size,107);
 assert.ok(!c.all.some(r=>r.version==='20261010222700'));
 assert.ok(c.all.find(r=>r.version==='20261031032349').sql.includes(
   'GRANT UPDATE ON TABLE public.organizations TO service_role'));
});

test('#325: materialize a sealed 107-file staging bundle in OS temporary space ONLY',()=>{
 const c=buildCandidate325();
 const result=writeDisposableCandidate325(c);
 try {
   assert.equal(result.files,107);
   assert.equal(result.safeForProduction,false);
   assert.match(result.dir,/inmojco-staging325-NO-PROD-/);
   const filenames=readdirSync(join(result.dir,'supabase','migrations'));
   assert.equal(filenames.length,107);
   const manifest=JSON.parse(readFileSync(join(result.dir,'STAGING-ONLY-MANIFEST.json'),'utf8'));
   assert.equal(manifest.safeForProduction,false);
   assert.equal(manifest.doNotMergeWithProduction,true);
   assert.equal(manifest.originalVersions,99);
   assert.equal(manifest.stagingPrerequisites,3);
   assert.equal(manifest.forwardApplied,5);
   assert.equal(manifest.files.length,107);
   for(const item of manifest.files){
     const sql=readFileSync(join(result.dir,'supabase','migrations',item.name),'utf8');
     assert.equal(gitBlobSha(sql),item.sha,item.name);
   }
   assert.equal(manifest.files.filter(x=>x.kind==='CANONICAL').length,99);
   assert.equal(manifest.files.filter(x=>x.kind==='STAGING_ONLY').length,3);
   assert.equal(manifest.files.filter(x=>x.kind==='FORWARD_APPLIED').length,5);
 } finally {rmSync(result.dir,{recursive:true,force:true});}
});
