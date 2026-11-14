import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  validateStorageManifest,assertExactStorageCoverage,verifyRestoredStorageBytes,
} from '../scripts/ops/verify-restored-storage-binaries.mjs';
import { test } from 'node:test';
import {
  parseStorageInventory, verifyStorageCoverage, readStorageInventory,
  STORAGE_INVENTORY_SQL,
} from '../scripts/lib/inmojco-storage-inventory.mjs';

function row(kind, bucket, path, revision) {
  return JSON.stringify({ kind, bucket, path, revision });
}
const baseline = [
  row('bucket','jco-inventory-private',null,'private-2026-10'),
  row('bucket','organization-documents',null,'private-2026-10'),
  row('bucket','jco-rent-receipts-private',null,'private-2026-10'),
  row('object','jco-inventory-private','apt-1088/photo.jpg','v1'),
  row('object','organization-documents','signed/lease-1088.pdf','signed-v1'),
  row('object','organization-documents','signed/lease-1089.pdf','signed-v3'),
].join('\n') + '\n';

function copies() {
  return [
    { bucket:'jco-inventory-private',path:'apt-1088/photo.jpg' },
    { bucket:'organization-documents',path:'signed/lease-1088.pdf' },
    { bucket:'organization-documents',path:'signed/lease-1089.pdf' },
  ];
}

test('read-only Storage SQL uses metadata and never mutates buckets or objects', () => {
  assert.match(STORAGE_INVENTORY_SQL,/from storage\.buckets/);
  assert.match(STORAGE_INVENTORY_SQL,/from storage\.objects/);
  assert.match(STORAGE_INVENTORY_SQL,/version/);
  assert.match(STORAGE_INVENTORY_SQL,/updated_at/);
  assert.match(STORAGE_INVENTORY_SQL,/md5\(metadata::text\)/);
  assert.doesNotMatch(STORAGE_INVENTORY_SQL,/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i);
});

test('stable inventory covers every private object and empty bucket', () => {
  const before = parseStorageInventory(baseline);
  const after = parseStorageInventory(baseline.split('\n').filter(Boolean).reverse().join('\n'));
  const result = verifyStorageCoverage(before,after,copies(),
    ['organization-documents','jco-rent-receipts-private','jco-inventory-private']);
  assert.equal(result.objects,3);
  assert.equal(result.buckets,3);
  assert.match(result.fingerprint,/^[a-f0-9]{64}$/);
});

test('new document uploaded during export rejects completed encrypted archive', () => {
  const after=baseline + row('object','organization-documents','new/signed.pdf','new-v1')+'\n';
  assert.throws(()=>verifyStorageCoverage(parseStorageInventory(baseline),
    parseStorageInventory(after),copies(),
    ['jco-inventory-private','organization-documents','jco-rent-receipts-private']),
  /Storage database inventory cannot be verified/);
});

test('updated or removed signed document with unchanged object counts is rejected',()=>{
  const changed=baseline.replace('signed-v1','signed-v2');
  const removed=baseline.replace(
    row('object','organization-documents','signed/lease-1088.pdf','signed-v1')+'\n','');
  for(const inventory of [changed,removed]) {
    assert.throws(()=>verifyStorageCoverage(parseStorageInventory(baseline),
      parseStorageInventory(inventory),copies(),
      ['jco-inventory-private','organization-documents','jco-rent-receipts-private']));
  }
});

test('manifest missing, extra or duplicated objects fails even if database is stable',()=>{
  const before=parseStorageInventory(baseline);
  const bucketIds=[...before.buckets.keys()];
  for(const copied of [copies().slice(0,2),copies().concat(copies()[0]),
    copies().slice(0,2).concat({bucket:'organization-documents',path:'secret/no-db-record.pdf'})])
    assert.throws(()=>verifyStorageCoverage(before,before,copied,bucketIds));
  assert.throws(()=>verifyStorageCoverage(before,before,copies(),bucketIds.slice(0,2)));
  assert.throws(()=>verifyStorageCoverage(before,before,copies(),bucketIds.concat(bucketIds[0])));
});

test('duplicate metadata, corrupt response and sensitive query errors fail closed',async()=>{
  const original=baseline.split('\n').filter(Boolean);
  assert.throws(()=>parseStorageInventory(original.concat(original[3]).join('\n')));
  assert.throws(()=>parseStorageInventory('{"kind":"object","bucket":"org","path":'));
  await assert.rejects(()=>readStorageInventory({
    PGHOST:'localhost',PGUSER:'postgres',PGPASSWORD:'bad-value',
    PGDATABASE:'database_that_does_not_exist',PGSSLMODE:'disable',
  }),err=>err.message==='Storage database inventory cannot be verified; backup rejected');
});

test('actual PostgreSQL 17 metadata inventory can be read without returning raw names in logs',async()=>{
  // CI provides ONLY this disposable fixture. Never use a real Supabase host.
  const environment = {
    PGHOST:'localhost',PGUSER:'postgres',PGPASSWORD:'postgres',
    PGDATABASE:'jco_storage_inventory_test',PGSSLMODE:'disable',
  };
  const first=await readStorageInventory(environment);
  const second=await readStorageInventory(environment);
  assert.equal(first.buckets.size,2);
  assert.equal(first.objects.size,2);
  assert.equal(first.sha256,second.sha256);
  const checks=verifyStorageCoverage(first,second,[
    {bucket:'organization-documents',path:'signed/mock-lease.pdf'},
    {bucket:'jco-inventory-private',path:'apt/fixture.png'},
  ],['organization-documents','jco-inventory-private']);
  assert.equal(checks.objects,2);
});


test('G18 restored binaries: verify original disk SHA-256 against every HTTPS clone byte',async()=>{
 const root=mkdtempSync(join(tmpdir(),'jco-g18-test-'));
 const file=join(root,'storage','jco-inventory-private','sample.png');
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,1,2,3]);
 const sha256=createHash('sha256').update(bytes).digest('hex');
 try{
  chmodSync(root,0o700);
  mkdirSync(join(root,'storage','jco-inventory-private'),{recursive:true,mode:0o700});
  writeFileSync(file,bytes,{mode:0o600});
  const manifest=[{bucket:'jco-inventory-private',path:'sample.png',bytes:bytes.length,sha256}];
  const fetchMock=async(url,options)=>{
   const pathname=new URL(url).pathname;
   assert.equal(new URL(url).origin,'https://zjgstfgiirgjssnihaam.supabase.co');
   assert.equal(options.redirect,'error');
   assert.equal(options.headers.apikey,'fixture-not-a-real-key');
   if(pathname.endsWith('/storage/v1/bucket'))
    return new Response(JSON.stringify([{id:'jco-inventory-private'}]),{status:200});
   if(pathname.includes('/storage/v1/object/list/'))
    return new Response(JSON.stringify([{name:'sample.png',id:'fake-object'}]),{status:200});
   if(pathname.includes('/storage/v1/object/authenticated/'))
    return new Response(bytes,{status:200});
   throw Error('Unrecognized fixture endpoint');
  };
  const args={root,manifest,origin:'https://zjgstfgiirgjssnihaam.supabase.co',
   secret:'fixture-not-a-real-key',fetchImpl:fetchMock};
  const result=await verifyRestoredStorageBytes(args);
  assert.deepEqual(result,{objects:1,buckets:1,verifiedBytes:bytes.length});
  assert.equal(validateStorageManifest(manifest).length,1);
  assert.equal(assertExactStorageCoverage(manifest,
   new Set(['jco-inventory-private\0sample.png'])),true);

  await assert.rejects(()=>verifyRestoredStorageBytes({...args,
    origin:'https://cuitgyqrjibgwuniapmk.supabase.co'}),/lanzamiento bloqueado/);
  const forged=structuredClone(manifest);forged[0].sha256='f'.repeat(64);
  await assert.rejects(()=>verifyRestoredStorageBytes({...args,manifest:forged}),/lanzamiento bloqueado/);
  const altered=async(url,opts)=>{
   if(new URL(url).pathname.includes('/object/authenticated/'))
    return new Response(Buffer.from([1,2,3]),{status:200});
   return fetchMock(url,opts);
  };
  await assert.rejects(()=>verifyRestoredStorageBytes({...args,fetchImpl:altered}),
    /lanzamiento bloqueado/);
  const extra=async(url,opts)=>{
   if(new URL(url).pathname.includes('/object/list/'))
    return new Response(JSON.stringify([
      {name:'sample.png',id:'fixture-one'},
      {name:'untracked.pdf',id:'fixture-two'}]),{status:200});
   return fetchMock(url,opts);
  };
  await assert.rejects(()=>verifyRestoredStorageBytes({...args,fetchImpl:extra}),
    /lanzamiento bloqueado/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('G18 manifest rejects traversal, duplicates, size drift, unauthenticated restores',()=>{
 const entry={bucket:'organization-documents',path:'signed/lease.pdf',bytes:100,
  sha256:'a'.repeat(64)};
 for(const path of ['../lease.pdf','signed//lease.pdf','./lease.pdf','signed\\lease.pdf']){
  assert.throws(()=>validateStorageManifest([{...entry,path}]),/lanzamiento bloqueado/);
 }
 assert.throws(()=>validateStorageManifest([entry,entry]),/lanzamiento bloqueado/);
 assert.throws(()=>validateStorageManifest([{...entry,bytes:0}]),/lanzamiento bloqueado/);
 assert.throws(()=>validateStorageManifest([{...entry,sha256:'not-sha'}]),/lanzamiento bloqueado/);
 assert.throws(()=>assertExactStorageCoverage([entry],new Set()),/lanzamiento bloqueado/);
});
