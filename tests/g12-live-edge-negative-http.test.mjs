import assert from 'node:assert/strict';
import { test } from 'node:test';

// Real HTTPS requests against LIVE DEPLOYED Supabase functions.
// All requests are unauthorized/invalid: no merchant keys, auth sessions,
// approved orders, paid transactions, customer data or Storage writes.
const base='https://cuitgyqrjibgwuniapmk.supabase.co/functions/v1';
const production=base+'/billing-production';
const sandbox=base+'/billing';
const allowed='https://www.inmojco.com';
const rejected='https://evil.inmojco.invalid';

async function call(url,{method='POST',origin=allowed,body,headers={}}={}) {
  const h={...(origin?{Origin:origin}:{}),...headers};
  const res=await fetch(url,{method,headers:h,
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(12000),redirect:'error'});
  const raw=await res.text();
  assert.ok(raw.length<2500,'Unexpectedly large response body');
  const data=res.headers.get('content-type')?.includes('application/json')
    ?JSON.parse(raw):null;
  // No API secrets, access tokens, signed URLs or private file paths are
  // ever allowed in error responses, even if the merchant is configured.
  assert.ok(!/prv_prod_|prod_events_|prod_integrity_|SUPABASE_SERVICE_ROLE_KEY/i.test(raw));
  return {status:res.status,cors:res.headers.get('access-control-allow-origin'),data};
}
function invalidRequest() {
  return {organizationId:'00000000-0000-4000-8000-000000000001',
    planId:'00000000-0000-4000-8000-000000000002',
    requestKey:'00000000-0000-4000-8000-000000000003'};
}

test('G12 LIVE: disallowed GET never invokes checkout',async()=>{
 const r=await call(production+'/checkout',{method:'GET'});
 assert.equal(r.status,405);
 assert.equal(r.data?.error,'method_not_allowed');
});
test('G12 LIVE: official CORS preflight works without a session',async()=>{
 const r=await call(production+'/checkout',{method:'OPTIONS'});
 assert.equal(r.status,200);
 assert.equal(r.cors,allowed);
});
test('G12 LIVE: hostile CORS preflight cannot borrow official origin',async()=>{
 const r=await call(production+'/checkout',{method:'OPTIONS',origin:rejected});
 assert.equal(r.status,403);
 assert.equal(r.cors,null);
});
test('G12 LIVE: hostile POST rejected before checking JWT or payment order',async()=>{
 const r=await call(production+'/checkout',{origin:rejected,
   body:invalidRequest(),headers:{'Content-Type':'application/json'}});
 assert.equal(r.status,403);
 assert.equal(r.data?.error,'origin_not_allowed');
});
test('G12 LIVE: no JWT means NO order and NO checkout URL',async()=>{
 const r=await call(production+'/checkout',{body:invalidRequest(),
   headers:{'Content-Type':'application/json'}});
 assert.equal(r.status,401);
 assert.equal(r.data?.error,'authentication_required');
 assert.equal(r.data?.checkoutUrl,undefined);
});
test('G12 LIVE: spoofed bearer token never generates an order',async()=>{
 const r=await call(production+'/checkout',{body:invalidRequest(),headers:{
   'Content-Type':'application/json',Authorization:'Bearer invalid-qa-token'}});
 assert.equal(r.status,401);
 assert.equal(r.data?.checkoutUrl,undefined);
});
test('G12 LIVE: fabricated Wompi webhook cannot activate a license',async()=>{
 const r=await call(production+'/events',{origin:null,
   headers:{'Content-Type':'application/json'},body:{
     event:'transaction.updated',environment:'prod',timestamp:1791670000,
     data:{transaction:{id:'qa_fake',reference:'JCO_fake',amount_in_cents:10000,
       currency:'COP',status:'APPROVED'}},
     signature:{properties:['transaction.id'],checksum:'0'.repeat(64)},
   }});
 // 503 = keys intentionally absent; 401 = configured but signature invalid.
 assert.ok([401,503].includes(r.status), 'Invalid event reached payment processor');
 assert.ok(['invalid_signature','payments_not_configured'].includes(r.data?.error));
});
test('G12 SANDBOX: its independent original gateway still requires JWT',async()=>{
 const r=await call(sandbox+'/checkout',{body:invalidRequest(),
   headers:{'Content-Type':'application/json'}});
 assert.equal(r.status,401);
 assert.equal(r.data?.error,'authentication_required');
});
