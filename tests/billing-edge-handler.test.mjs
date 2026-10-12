import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createBillingHandler, sha256 } from '../supabase/functions/_shared/billing-handler.ts';

const config = { environment: 'sandbox', publicKey: 'pub_test_fixture', eventsSecret: 'test_events_fixture_only',
  integritySecret: 'test_integrity_fixture_only', appUrl: 'https://www.inmojco.com/', allowedOrigins: ['https://www.inmojco.com'] };
const tx = { id: 'tx-fixture', reference: 'JCO_fixture_01', amount_in_cents: 10490000, currency: 'COP', status: 'APPROVED' };
async function event(transaction = tx, timestamp = 1791670000) {
  return { event: 'transaction.updated', environment: 'test', data: { transaction }, timestamp,
    signature: { properties: ['transaction.id','transaction.status','transaction.amount_in_cents'],
      checksum: await sha256(transaction.id+transaction.status+transaction.amount_in_cents+timestamp+config.eventsSecret) } };
}
function fixture(overrides = {}, cfg = config) {
  const calls = [];
  const handler = createBillingHandler(cfg, { getUser: async ()=>'user-fixture', createOrder: async (_token,args)=> {
    calls.push({kind:'order',args});
    return { data: { id:'order-fixture',reference:tx.reference,amount_in_cents:tx.amount_in_cents,currency:'COP',
      status:'PENDING',expires_at:new Date(Date.now()+600000).toISOString() },error:null };
  }, fetchTransaction: async () => { calls.push({kind:'lookup'}); return {data:tx}; },
  processEvent: async args=> { calls.push({kind:'event',args}); return {data:'processed',error:null}; }, ...overrides });
  const request = (body,path='/events',headers={})=> handler(new Request('https://example.supabase.co/functions/v1/billing'+path,
    {method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
  return {request,calls};
}
test('authentic webhook is reconciled and records actual payload digest', async()=> {
  const f=fixture(); const body=await event(); const raw=JSON.stringify(body);
  assert.equal((await f.request(raw)).status,200); assert.equal(f.calls[0].kind,'lookup');
  assert.equal(f.calls[1].args.p_payload_sha256,await sha256(raw));
  assert.notEqual(f.calls[1].args.p_payload_sha256,f.calls[1].args.p_event_id);
});
test('changing unsigned reference is rejected by API reconciliation', async()=> {
  const f=fixture(); const body=await event({...tx,reference:'JCO_other_tenant'});
  assert.equal((await f.request(body)).status,409); assert.equal(f.calls.filter(c=>c.kind==='event').length,0);
});
test('wrong signature never reaches provider or database', async()=> {
  const f=fixture(); const body=await event(); body.signature.checksum='0'.repeat(64);
  assert.equal((await f.request(body)).status,401); assert.deepEqual(f.calls,[]);
});
test('Sandbox events cannot enter a production handler', async()=> {
  const f=fixture({}, {...config,environment:'production'});
  assert.equal((await f.request(await event())).status,401);
});
test('a pending event does not activate or query the payment store', async()=> {
  const f=fixture(); assert.equal((await f.request(await event({...tx,status:'PENDING'}))).status,200); assert.deepEqual(f.calls,[]);
});
test('provider failures fail closed and remain retryable', async()=> {
  const f=fixture({fetchTransaction:async()=>{throw new Error('unavailable');}});
  assert.equal((await f.request(await event())).status,503); assert.deepEqual(f.calls,[]);
});
test('redelivery timestamps retain the same idempotent transaction identity', async()=> {
  const f=fixture(); await f.request(await event(tx,1791670000)); await f.request(await event(tx,1791670001));
  const events=f.calls.filter(c=>c.kind==='event');
  assert.equal(events[0].args.p_event_id,events[1].args.p_event_id);
  assert.notEqual(events[0].args.p_payload_sha256,events[1].args.p_payload_sha256);
});
test('checkout requires a verified user session', async()=> {
  const f=fixture({getUser:async()=>null});
  assert.equal((await f.request({},'/checkout',{authorization:'Bearer fake'})).status,401); assert.deepEqual(f.calls,[]);
});
test('missing merchant secrets fail closed without creating an order', async()=> {
  const f=fixture({}, {...config,eventsSecret:''});
  assert.equal((await f.request({},'/checkout',{authorization:'Bearer fake'})).status,503); assert.deepEqual(f.calls,[]);
});
test('checkout uses server price and signs the same expiration sent to Wompi', async()=> {
  const f=fixture(); const body={organizationId:'20000000-0000-0000-0000-000000000002',planId:'60000000-0000-0000-0000-000000000001',requestKey:'50000000-0000-0000-0000-000000000001',amount:1};
  const result=await (await f.request(body,'/checkout',{authorization:'Bearer fake'})).json();
  const url=new URL(result.checkoutUrl); assert.equal(url.origin,'https://checkout.wompi.co');
  assert.equal(url.searchParams.get('amount-in-cents'),'10490000');
  assert.equal(url.searchParams.get('signature:integrity'),await sha256(tx.reference+tx.amount_in_cents+'COP'+url.searchParams.get('expiration-time')+config.integritySecret));
  assert.equal(url.searchParams.get('redirect-url'),'https://www.inmojco.com/?billing=return');
  assert.equal(f.calls[0].args.target_environment,'sandbox'); assert.equal(Object.hasOwn(f.calls[0].args,'amount'),false);
});
test('untrusted origins are denied before authentication', async()=> {
  const f=fixture(); assert.equal((await f.request({},'/checkout',{origin:'https://attacker.example'})).status,403); assert.deepEqual(f.calls,[]);
});
test('oversized or malformed payloads are rejected without side effects', async()=> {
  const f=fixture(); assert.equal((await f.request('x'.repeat(65537))).status,413);
  assert.equal((await f.request('{')).status,400); assert.deepEqual(f.calls,[]);
});

test('canonical app.inmojco.com origin is enabled in the deployed billing entrypoint', async () => {
  const entrypoint = readFileSync('supabase/functions/billing/index.ts', 'utf8');
  assert.match(entrypoint, /allowedOrigins: \['https:\/\/app\.inmojco\.com'/);
  assert.match(entrypoint, /appUrl: Deno\.env\.get\('APP_URL'\) \?\? 'https:\/\/app\.inmojco\.com\/'/);
  const cfg = { ...config, appUrl: 'https://app.inmojco.com/',
    allowedOrigins: ['https://app.inmojco.com'] };
  const f = fixture({}, cfg);
  const body = { organizationId: '20000000-0000-0000-0000-000000000002',
    planId: '60000000-0000-0000-0000-000000000001',
    requestKey: '50000000-0000-0000-0000-000000000001' };
  const result = await f.request(body, '/checkout',
    { authorization: 'Bearer fixture', origin: 'https://app.inmojco.com' });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('access-control-allow-origin'), 'https://app.inmojco.com');
  const payload = await result.json();
  assert.equal(new URL(payload.checkoutUrl).searchParams.get('redirect-url'),
    'https://app.inmojco.com/?billing=return');
  const forbidden = await f.request(body, '/checkout',
    { authorization: 'Bearer fixture', origin: 'https://malicious.example' });
  assert.equal(forbidden.status, 403);
});
