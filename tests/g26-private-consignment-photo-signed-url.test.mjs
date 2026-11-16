import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import {transformSync} from 'esbuild';

const source=readFileSync(new URL('../supabase/functions/consignment-photo-review/index.ts',import.meta.url),'utf8');
const upload=readFileSync(new URL('../supabase/functions/consignment-photo-upload/index.ts',import.meta.url),'utf8');
const javascript=transformSync(source.replace(/^import\s+\{\s*createClient\s*\}[^;]+;\s*/m,''),{
  loader:'ts',target:'es2022',format:'iife',
}).code;

const own='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const foreign='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const consignment='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const fileId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const allowedPath=own+'/'+consignment+'/0-'+fileId;
const otherPath=foreign+'/'+consignment+'/0-'+fileId;

function fixture(storagePath, {exposeConsignment=true,exposePhotos=true}={}){
 const signed=[];
 const privileged={
  auth:{async getUser(token){
    assert.equal(token,'fixture-token');
    return {data:{user:{id:'qa'}},error:null};
  }},
  storage:{from(bucket){
    assert.equal(bucket,'jco-consignment-photos');
    return {async createSignedUrl(path,ttl){
      signed.push({path,ttl});
      return {data:{signedUrl:'https://signed.example.invalid/private'},error:null};
    }};
  }},
 };
 const asUser={
  from(table){
    if(table==='property_consignments')return {
      select(columns){assert.equal(columns,'id,organization_id');return this;},
      eq(key,value){assert.equal(key,'id');assert.equal(value,consignment);return this;},
      async maybeSingle(){return {data:exposeConsignment?{id:consignment,organization_id:own}:null,error:null};},
    };
    assert.equal(table,'property_consignment_photos');
    return {
      select(columns){assert.equal(columns,'id,position,storage_path');return this;},
      eq(key,value){assert.equal(key,'consignment_id');assert.equal(value,consignment);return this;},
      async order(key){assert.equal(key,'position');return {data:exposePhotos?[{id:fileId,position:0,storage_path:storagePath}]:[],error:null};},
    };
  },
 };
 let handler=null;
 const ctx={
  createClient:(_url,key)=>key==='SUPABASE_SERVICE_ROLE_KEY'?privileged:asUser,
  Deno:{env:{get:(name)=>name},serve:(fn)=>{handler=fn;}},
  Request,Response,URL,JSON,Set,
 };
 vm.runInNewContext(javascript,ctx,{timeout:2000,filename:'photo-review.ts'});
 assert.equal(typeof handler,'function');
 const invoke=async(origin='https://www.inmojco.com')=>{
   const req=new Request('https://fixture.invalid/functions/v1/consignment-photo-review',{
     method:'POST',headers:{origin,authorization:'Bearer fixture-token','content-type':'application/json'},
     body:JSON.stringify({consignmentId:consignment}),
   });
   const res=await handler(req);
   return {status:res.status,body:await res.json()};
 };
 return {invoke,signed};
}

test('G26: tenant reviewer signs only its own path for five minutes',async()=>{
 const x=fixture(allowedPath);
 const response=await x.invoke();
 assert.equal(response.status,200);
 assert.equal(response.body.photos.length,1);
 assert.deepEqual(x.signed,[{path:allowedPath,ttl:300}]);
});

test('G26: foreign Storage path, even in a readable row, never gets a signed URL',async()=>{
 const x=fixture(otherPath);
 const response=await x.invoke();
 assert.equal(response.status,403);
 assert.equal(response.body.error,'invalid_photo_scope');
 assert.equal(x.signed.length,0);
});

test('G26: invalid object suffix, missing membership or invisible photo denies signing',async()=>{
 for (const path of [own+'/'+consignment+'/0-traversal',own+'/'+consignment+'/10-'+fileId]){
   const x=fixture(path);
   assert.equal((await x.invoke()).status,403);
   assert.equal(x.signed.length,0);
 }
 const x=fixture(allowedPath,{exposeConsignment:false});
 assert.equal((await x.invoke()).status,404);
 assert.equal(x.signed.length,0);
});

test('G26: retired app subdomain has no CORS access to either photo function',async()=>{
 const x=fixture(allowedPath);
 const response=await x.invoke('https://app.inmojco.com');
 assert.equal(response.status,403);
 assert.equal(x.signed.length,0);
 for(const contents of [source,upload]){
   assert.doesNotMatch(contents,/['"]https:\/\/app\.inmojco\.com['"]/);
   assert.match(contents,/https:\/\/www\.inmojco\.com/);
 }
});
