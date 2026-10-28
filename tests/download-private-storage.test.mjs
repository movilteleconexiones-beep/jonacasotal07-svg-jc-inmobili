import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, mkdir, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { snapshotStorage, REQUIRED_BUCKETS } from '../scripts/recovery/download-private-storage.mjs';

async function temp(t) {
  const parent=await mkdtemp(join(tmpdir(),'inmojco-storage-private-test-'));
  t.after(()=>rm(parent,{recursive:true,force:true}));
  return {parent, root:join(parent,'new-export')};
}
function makeClient({failList=false,failDownload=false,evilEntry=null,mismatchSize=false}={}) {
  const objects={
    'jco-inventory-private':[
      {key:'folder/a.jpg',data:'fake byte content A'},
      {key:'folder/b.pdf',data:'fake document content B'}
    ],
    'organization-documents':[{key:'receipt.txt',data:'fake receipt'}],
  };
  const api={
    from(bucket) {
      const files=objects[bucket] || [];
      return {
        async list(prefix,{limit,offset}) {
          if(failList) return {data:null,error:new Error('fake listing failed')};
          if(evilEntry && bucket===REQUIRED_BUCKETS[0]) return {data:[evilEntry],error:null};
          const names=new Map();
          for(const f of files) {
            const rest=prefix ? (f.key.startsWith(prefix+'/') ? f.key.slice(prefix.length+1):null):f.key;
            if(!rest) continue;
            const first=rest.split('/')[0];
            names.set(first,rest.includes('/')?{name:first,id:null}:{name:first,id:'fake-object-id'});
          }
          const entries=[...names.values()].map(entry=>{
            if(entry.id===null) return entry;
            const fullKey=prefix ? prefix+'/'+entry.name : entry.name;
            const source=files.find(x=>x.key===fullKey);
            return {...entry,metadata:{size:Buffer.byteLength(source.data)+(mismatchSize?1:0)}};
          }).sort((a,b)=>a.name.localeCompare(b.name));
          return {data:entries.slice(offset,offset+limit),error:null};
        },
        async download(key) {
          if(failDownload) return {data:null,error:new Error('fake download failed')};
          const f=files.find(o=>o.key===key);
          return f?{data:new Blob([f.data]),error:null}:{data:null,error:new Error('not found')};
        }
      };
    }
  };
  return api;
}

test('downloads fictional files from private folder hierarchy and hashes exact bytes',async t=>{
  const {root}=await temp(t);
  const result=await snapshotStorage(makeClient(),root,{listLimit:1});
  assert.deepEqual({objectCount:result.objectCount,bucketCount:result.bucketCount},{objectCount:3,bucketCount:4});
  const audit=JSON.parse(await readFile(join(root,'storage-download-audit.local.json'),'utf8'));
  assert.equal(audit.objects.length,3);
  assert.equal(audit.buckets.length,4);
  assert.deepEqual(audit.buckets.map(b=>b.object_count),[0,2,0,1]);
  for(const item of audit.objects) {
    const bytes=await readFile(join(root,'storage',item.bucket,...item.path.split('/')));
    assert.equal(item.sha256,createHash('sha256').update(bytes).digest('hex'));
  }
  await assert.rejects(lstat(join(root,'STORAGE-COPIA-INCOMPLETA.txt')),/ENOENT/);
});

test('never overwrites a previous private Storage snapshot',async t=>{
  const {root}=await temp(t);
  await snapshotStorage(makeClient(),root);
  await assert.rejects(snapshotStorage(makeClient(),root),/EEXIST/);
});
test('rejects dangerous remote path components',async t=>{
  const {root}=await temp(t);
  await assert.rejects(snapshotStorage(makeClient({evilEntry:{name:'..',id:'file'}}),root),/no seguro/);
  await assert.rejects(readFile(join(root,'storage-download-audit.local.json')),/ENOENT/);
  assert.match(await readFile(join(root,'STORAGE-COPIA-INCOMPLETA.txt'),'utf8'),/NO UTILIZAR/);
});
test('fails closed when remote listing fails and never marks a complete backup',async t=>{
  const {root}=await temp(t);
  await assert.rejects(snapshotStorage(makeClient({failList:true}),root),/inventariar/);
  await assert.rejects(readFile(join(root,'storage-download-audit.local.json')),/ENOENT/);
});
test('fails closed when byte download fails and preserves incomplete marker',async t=>{
  const {root}=await temp(t);
  await assert.rejects(snapshotStorage(makeClient({failDownload:true}),root),/Descarga privada incompleta/);
  assert.match(await readFile(join(root,'STORAGE-COPIA-INCOMPLETA.txt'),'utf8'),/NO UTILIZAR/);
});
test('never runs from a private directory within a git checkout',async t=>{
  const {parent,root}=await temp(t);
  await mkdir(join(parent,'.git'));
  await assert.rejects(snapshotStorage(makeClient(),root),/repositorio Git/);
});

test('rejects a downloaded byte count different from remote object metadata',async t=>{
  const {root}=await temp(t);
  await assert.rejects(snapshotStorage(makeClient({mismatchSize:true}),root),/tamaño descargado/);
  assert.match(await readFile(join(root,'STORAGE-COPIA-INCOMPLETA.txt'),'utf8'),/NO UTILIZAR/);
});
