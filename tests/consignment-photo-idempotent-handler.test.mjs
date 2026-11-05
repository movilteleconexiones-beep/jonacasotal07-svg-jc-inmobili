import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { File } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

// Execute the actual Deno Edge handler in an isolated Node VM with a
// disposable in-memory database and private Storage. No network or secrets.
const source=readFileSync(new URL('../supabase/functions/consignment-photo-upload/index.ts',import.meta.url),'utf8');
const js=transformSync(source.replace(/^import\s+\{\s*createClient\s*\}[^;]+;\s*/m,''),{
 loader:'ts',target:'es2022',format:'iife',
}).code;
const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const consignmentId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const reference='CON-DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD';
const siteSlug='sistema-inmobiliario-jco';

function sandbox() {
 const rows=new Map();
 const objects=new Map();
 let uploads=0,removals=0,downloads=0,resolveAllowed=true;
 const scope={
  from(table) {
   assert.equal(table,'property_consignment_photos');
   return {
    select(_columns,opts={}) {
     const filters={};
     const query={
      eq(column,value){filters[column]=value;return this;},
      async maybeSingle(){
       const data=rows.get(filters.position)??null;
       return {data: data&&filters.consignment_id===consignmentId?data:null,error:null};
      },
      then(resolve,reject) {
       return Promise.resolve({count:[...rows.values()].filter(x=>x.consignment_id===filters.consignment_id).length,error:null}).then(resolve,reject);
      },
     };
     return query;
    },
    async insert(record) {
     if(rows.has(record.position))return {error:{code:'23505'}};
     rows.set(record.position,{...record});
     return {error:null};
    },
   };
  },
  async rpc(name,{p_slug,p_request_id,p_reference}) {
   assert.equal(name,'resolve_consignment_photo_submission');
   return {data:resolveAllowed&&p_slug===siteSlug&&p_request_id===requestId&&p_reference===reference
    ?[{id:consignmentId,organization_id:org}]:[],error:null};
  },
  storage:{
   from(bucket){
    assert.equal(bucket,'jco-consignment-photos');
    return {
     async upload(path,body,{upsert}) {
      assert.equal(upsert,false);
      if(objects.has(path))return {error:{message:'exists'}};
      uploads++;objects.set(path,new Uint8Array(body));
      return {error:null};
     },
     async download(path){
      downloads++;
      const bytes=objects.get(path);
      if(!bytes)return {data:null,error:{message:'missing'}};
      return {data:new Blob([bytes]),error:null};
     },
     async remove(paths){
      removals++;
      for(const path of paths)objects.delete(path);
      return {error:null};
     },
    };
   },
  },
 };
 let handler;
 const context={createClient:()=>scope,
  Deno:{env:{get:()=> 'fixture-only'},serve:(fn)=>{handler=fn;}},
  Request,Response,File,Uint8Array,Blob,FormData,crypto:webcrypto,console};
 vm.runInNewContext(js,context,{timeout:1000,filename:'consignment-photo-upload.ts'});
 assert.equal(typeof handler,'function');
 async function upload(bytes,position=0,{id=requestId,ref=reference,slug=siteSlug}={}) {
  const form=new FormData();
  form.set('siteSlug',slug);form.set('requestId',id);form.set('reference',ref);
  form.set('position',String(position));
  form.set('photo',new File([bytes],'imagen.jpg',{type:'image/jpeg'}));
  const response=await handler(new Request('https://fixture.invalid/functions/v1/consignment-photo-upload',{
   method:'POST',headers:{origin:'https://www.inmojco.com'},body:form,
  }));
  return {status:response.status,body:await response.json()};
 }
 return {
  upload,rows,objects,
  stats:()=>({uploads,removals,downloads}),
  revokeCapability:()=>{resolveAllowed=false;},
 };
}
const jpg=(variant=0)=>new Uint8Array([255,216,255,224,variant,17,18,19]);

test('first image persists once; exact retry acknowledges stored bytes without duplicate',async()=>{
 const x=sandbox();
 const first=await x.upload(jpg());
 assert.equal(first.status,201);
 const second=await x.upload(jpg());
 assert.equal(second.status,200);
 assert.equal(second.body.alreadySaved,true);
 assert.equal(x.rows.size,1);
 assert.equal(x.objects.size,1);
 assert.equal(x.stats().uploads,1);
 assert.equal(x.stats().downloads,1);
});

test('same position with different photo cannot overwrite or falsely acknowledge',async()=>{
 const x=sandbox();
 assert.equal((await x.upload(jpg())).status,201);
 const retry=await x.upload(jpg(1));
 assert.equal(retry.status,409);
 assert.equal(retry.body.error,'photo_position_conflict');
 assert.equal(x.objects.size,1);
 assert.equal(x.stats().uploads,1);
});

test('lost reply on final tenth image is retriable even when quota is full',async()=>{
 const x=sandbox();
 for(let pos=0;pos<10;pos++)assert.equal((await x.upload(jpg(pos),pos)).status,201);
 assert.equal((await x.upload(jpg(9),9)).status,200);
 assert.equal(x.rows.size,10);
 assert.equal(x.objects.size,10);
 assert.equal(x.stats().uploads,10);
});

test('concurrent equal images converge to one persisted photo and clean losing object',async()=>{
 const x=sandbox();
 const results=await Promise.all([x.upload(jpg()),x.upload(jpg())]);
 assert.deepEqual(results.map(x=>x.status).sort((a,b)=>a-b),[200,201]);
 assert.equal(x.rows.size,1);
 assert.equal(x.objects.size,1);
 assert.equal(x.stats().uploads,2);
 assert.equal(x.stats().removals,1);
});

test('missing Storage evidence and wrong tenant scope fail closed',async()=>{
 const x=sandbox();
 assert.equal((await x.upload(jpg())).status,201);
 const [savedPath]=x.objects.keys();
 x.objects.delete(savedPath);
 const missing=await x.upload(jpg());
 assert.equal(missing.status,503);
 assert.equal(missing.body.error,'photo_verification_unavailable');
 assert.equal(x.stats().uploads,1);
 const y=sandbox();
 y.revokeCapability();
 assert.equal((await y.upload(jpg())).status,404);
 assert.equal(y.rows.size,0);
 assert.equal(y.objects.size,0);
});

test('handler source maintains image magic validation and safe no-upsert Storage',()=>{
 assert.match(source,/magic\(bytes,file\.type\)/);
 assert.match(source,/upsert:false/);
 assert.match(source,/existingPhotoState\(consignment,position,file,bytes\)/);
 assert.match(source,/crypto\.subtle\.digest\('SHA-256',bytes\)/);
 assert.doesNotMatch(source,/getPublicUrl\(/);
});
