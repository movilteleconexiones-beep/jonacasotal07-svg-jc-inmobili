import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOfflineManifest, REQUIRED_BUCKETS, PROJECT_REF } from '../scripts/recovery/create-offline-manifest.mjs';
import { verifyBackupIntegrity } from '../scripts/recovery/verify-backup-integrity.mjs';

const now = new Date('2026-10-27T22:30:00.000Z');
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'inmojco-recovery-generator-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'postgres.dump.age'),'fictitious encrypted dump');
  for(const bucket of REQUIRED_BUCKETS) await mkdir(join(root,'storage',bucket),{recursive:true});
  await writeFile(join(root,'storage','jco-inventory-private','fictitious.jpg'),'fictitious image bytes');
  const inventory={project_ref:PROJECT_REF,observed_at_utc:now.toISOString(),buckets:REQUIRED_BUCKETS.map(id=>({id,object_count:id==='jco-inventory-private'?1:0}))};
  const inventoryPath=join(root,'inventory-input.json');
  const save=()=>writeFile(inventoryPath,JSON.stringify(inventory));
  await save();
  return {root,inventory,inventoryPath,save};
}
async function run(f){return createOfflineManifest(f.root,'postgres.dump.age',f.inventoryPath,{now});}

test('creates private manifest with matching count and SHA; validates with existing verifier',async t=>{
  const f=await fixture(t);
  const r=await run(f);
  assert.equal(r.objects,1);
  const verified=await verifyBackupIntegrity(r.manifestPath,f.root);
  assert.deepEqual(verified,{objects_verified:1,buckets_verified:4,db_verified:true});
});
test('refuses mismatched counts (missing actual backup objects)',async t=>{
  const f=await fixture(t);f.inventory.buckets.find(x=>x.id==='jco-inventory-private').object_count=2;await f.save();
  await assert.rejects(run(f),/Conteo remoto\/local/);
});
test('refuses missing buckets in independent inventory',async t=>{
  const f=await fixture(t);f.inventory.buckets.pop();await f.save();
  await assert.rejects(run(f),/Faltan buckets/);
});
test('refuses stale and wrong project inventories',async t=>{
  const f=await fixture(t);f.inventory.observed_at_utc='2026-10-25T10:00:00Z';await f.save();
  await assert.rejects(run(f),/no reciente/);
  f.inventory.observed_at_utc=now.toISOString();f.inventory.project_ref='someone-else';await f.save();
  await assert.rejects(run(f),/proyecto no válido/);
});
test('refuses non-encrypted backup filenames and extra buckets',async t=>{
  const f=await fixture(t);await assert.rejects(createOfflineManifest(f.root,'postgres.sql',f.inventoryPath,{now}),/cifrado/);
  await mkdir(join(f.root,'storage','extra-bucket'));
  await assert.rejects(run(f),/Buckets locales/);
});
test('refuses symlinked storage files',async t=>{
  const f=await fixture(t);
  await symlink(join(f.root,'postgres.dump.age'),join(f.root,'storage','jco-inventory-private','extra-link'));
  await assert.rejects(run(f),/enlace simbólico/);
});
test('will not overwrite existing manifest',async t=>{
  const f=await fixture(t);await run(f);
  await assert.rejects(run(f),/EEXIST/);
});
test('refuses backups saved inside a Git working tree',async t=>{
  const f=await fixture(t);await mkdir(join(f.root,'.git'));
  await assert.rejects(run(f),/repositorio Git/);
});