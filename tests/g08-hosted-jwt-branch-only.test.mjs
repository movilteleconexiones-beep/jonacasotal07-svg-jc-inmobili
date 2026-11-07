import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// G08 branch-only TEST: all identities and property data below are fictitious.
// The Supabase key is PUBLIC/PUBLISHABLE (not a service role key).
// The branch will be deleted when QA is complete. NO production keys or PII.
const base='https://jrpkcsqzqrofzqphdaie.supabase.co';
const apikey="sb_publishable_-eV6eI3ocQ8z_JI5etuQrg_-vThI6Fz";
const ORG_A='a1000000-0000-4000-8000-000000000001';
const ORG_B='b2000000-0000-4000-8000-000000000002';
const users=[
{uid:'a1000000-0000-4000-8000-000000000101',email:'g08-admin-a@example.invalid',role:'ADMIN_A',org:ORG_A,properties:1,contacts:1,payment:true,admin:true},
{uid:'a1000000-0000-4000-8000-000000000102',email:'g08-coord-a@example.invalid',role:'COORD_A',org:ORG_A,properties:1,contacts:1,payment:true,admin:false},
{uid:'a1000000-0000-4000-8000-000000000103',email:'g08-agent-a@example.invalid',role:'AGENT_A',org:ORG_A,properties:1,contacts:1,payment:false,admin:false},
{uid:'a1000000-0000-4000-8000-000000000104',email:'g08-client-a@example.invalid',role:'CLIENT_A',org:ORG_A,properties:0,contacts:0,payment:false,admin:false},
{uid:'b2000000-0000-4000-8000-000000000201',email:'g08-admin-b@example.invalid',role:'ADMIN_B',org:ORG_B,properties:1,contacts:1,payment:true,admin:true}
];

async function http(path,{token=null,body=null,method='GET'}={}){
 const res=await fetch(base+path,{
 method,headers:{
  apikey,
  ...(token?{Authorization:'Bearer '+token}:{}),
  ...(body!==null?{'Content-Type':'application/json'}:{})
 },body:body===null?undefined:JSON.stringify(body),
 signal:AbortSignal.timeout(13000),redirect:'error'});
 const payload=await res.text();
 assert.ok(payload.length < 20000,'Response too large');
 return {status:res.status,body:payload};
}
async function login(user){
 const derived='G08qa-'+createHash('md5').update(user.uid+'g08-stage-20261107').digest('hex').slice(0,24);
 const res=await http('/auth/v1/token?grant_type=password',{method:'POST',body:{email:user.email,password:derived}});
 assert.equal(res.status,200,`${user.role} Auth failed HTTP ${res.status}: ${JSON.stringify(JSON.parse(res.body||'{}').code??'missing_code')}`);
 const data=JSON.parse(res.body);
 assert.ok(data.access_token && data.token_type==='bearer','Actual JWT required');
 const jwt=JSON.parse(Buffer.from(data.access_token.split('.')[1],'base64url').toString());
 assert.equal(jwt.sub,user.uid);
 assert.equal(jwt.role,'authenticated');
 return data.access_token;
}
function decode(reply,label){
 assert.equal(reply.status,200,`${label} HTTP ${reply.status}: ${reply.body.slice(0,450)}`);
 return JSON.parse(reply.body);
}
async function allowed(token,org,permission){
 const res=await http('/rest/v1/rpc/has_org_permission',{method:'POST',token,body:{
  target_org:org,permission_key:permission
 }});
 return decode(res,'role permission '+permission);
}
for(const u of users){
 test(`G08 hosted Supabase Auth JWT + PostgREST RLS: ${u.role}`,async()=>{
  const token=await login(u);
  const props=decode(await http('/rest/v1/properties?select=id,organization_id,code&order=code.asc',{token}),u.role+' properties');
  const contacts=decode(await http('/rest/v1/contacts?select=id,organization_id&order=id.asc',{token}),u.role+' contacts');
  assert.ok(Array.isArray(props)&&Array.isArray(contacts));
  assert.equal(props.length,u.properties);
  assert.equal(contacts.length,u.contacts);
  assert.ok(props.every(p=>p.organization_id===u.org));
  assert.ok(contacts.every(c=>c.organization_id===u.org));
  assert.equal(await allowed(token,u.org,'rent_payments.view'),u.payment);
  assert.equal(await allowed(token,u.org,'users.edit'),u.admin);
  const opposite=u.org===ORG_A?ORG_B:ORG_A;
  assert.equal(await allowed(token,opposite,'properties.view'),false);
  const cross=decode(await http('/rest/v1/properties?select=id&organization_id=eq.'+opposite,{token}),u.role+' cross tenant');
  assert.deepEqual(cross,[]);
 });
}
test('G08 hosted anonymous API cannot expose internal contacts or inventory',async()=>{
 for(const name of ['contacts','properties']){
  const reply=await http('/rest/v1/'+name+'?select=id');
  assert.ok([401,403].includes(reply.status),name+' unexpectedly readable to anon: '+reply.status);
 }
});
