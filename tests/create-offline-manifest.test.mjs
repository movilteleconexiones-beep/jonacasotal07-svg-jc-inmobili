import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
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
  const inventory={
    format_version:2,
    project_ref:PROJECT_REF,
    observed_at_utc:now.toISOString(),
    object_keys_sha256:createHash('sha256')
      .update(Buffer.from('jco-inventory-private/fictitious.jpg','utf8').toString('hex'),'utf8')
      .digest('hex'),
    buckets:REQUIRED_BUCKETS.map(id=>({id,object_count:id==='jco-inventory-private'?1:0}))
  };
  const inventoryPath=join(root,'inventory-input.json');
  const save=()=>writeFile(inventoryPath,JSON.stringify(inventory));
  await save();
  const storageAudit={
    project_ref:PROJECT_REF,
    downloaded_at_utc:now.toISOString(),
    buckets:REQUIRED_BUCKETS.map(id=>({id,object_count:id==='jco-inventory-private'?1:0})),
    objects:[{bucket:'jco-inventory-private',path:'fictitious.jpg',
      sha256:createHash('sha256').update('fictitious image bytes').digest('hex'),
      size:Buffer.byteLength('fictitious image bytes')}]
  };
  const auditPath=join(root,'storage-download-audit.local.json');
  const saveAudit=()=>writeFile(auditPath,JSON.stringify(storageAudit));
  await saveAudit();
  return {root,inventory,inventoryPath,save,storageAudit,auditPath,saveAudit};
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
test('rejects substituted Storage path even when object counts still match',async t=>{
  const f=await fixture(t);
  await rename(join(f.root,'storage','jco-inventory-private','fictitious.jpg'),
    join(f.root,'storage','jco-inventory-private','substitute.jpg'));
  await assert.rejects(run(f),/Identidades de Storage diferentes/);
});
test('requires SQL version 2 inventory with a valid path fingerprint',async t=>{
  const f=await fixture(t);
  delete f.inventory.object_keys_sha256;await f.save();
  await assert.rejects(run(f),/Inventario remoto de proyecto no válido/);
  f.inventory.object_keys_sha256='a'.repeat(64);await f.save();
  await assert.rejects(run(f),/Identidades de Storage diferentes/);
});

test('rejects a manifest whose recorded source-key hash has been altered',async t=>{
  const f=await fixture(t);
  const result=await run(f);
  const manifest=JSON.parse(await readFile(result.manifestPath,'utf8'));
  manifest.source_object_keys_sha256='0'.repeat(64);
  await writeFile(result.manifestPath,JSON.stringify(manifest));
  await assert.rejects(verifyBackupIntegrity(result.manifestPath,f.root),/Rutas Storage no coinciden/);
});

test('refuses Storage bytes altered after the original downloader audit',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.root,'storage','jco-inventory-private','fictitious.jpg'),'new spoofed image bytes');
  await assert.rejects(run(f),/bytes actuales difieren/);
});
test('rejects an audit report for a different Storage content hash or byte count',async t=>{
  const f=await fixture(t);
  f.storageAudit.objects[0].sha256='0'.repeat(64);
  await f.saveAudit();
  await assert.rejects(run(f),/bytes actuales difieren/);
  f.storageAudit.objects[0].sha256=createHash('sha256').update('fictitious image bytes').digest('hex');
  f.storageAudit.objects[0].size+=1;
  await f.saveAudit();
  await assert.rejects(run(f),/tamaño local difiere/);
});
test('refuses a missing download audit or an explicitly incomplete Storage export',async t=>{
  const f=await fixture(t);
  await rm(f.auditPath);
  await assert.rejects(run(f),/ENOENT/);
  await f.saveAudit();
  await writeFile(join(f.root,'STORAGE-COPIA-INCOMPLETA.txt'),'INCOMPLETE');
  await assert.rejects(run(f),/marcada incompleta/);
});
test('rejects a stale or unconnected original downloader audit',async t=>{
  const f=await fixture(t);
  f.storageAudit.downloaded_at_utc='2026-10-25T11:00:00.000Z';
  await f.saveAudit();
  await assert.rejects(run(f),/fuera de la ventana/);
});
test('rejects a partial audit inventory, even with remote counts matching downloaded files',async t=>{
  const f=await fixture(t);
  f.storageAudit.objects=[];
  await f.saveAudit();
  await assert.rejects(run(f),/no contiene todos/);
});
