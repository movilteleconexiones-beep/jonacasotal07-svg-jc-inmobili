import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {createBillingHandler, sha256} from '../supabase/functions/_shared/billing-handler.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

// Supabase's Edge gateway verifies JWTs by default. Wompi never supplies a
// user's Supabase JWT, so this function must verify webhook signatures itself.
test('billing Edge gateway admits signed Wompi webhooks without an account JWT', () => {
  const config = read('supabase/config.toml');
  assert.match(config, /^\[functions\.billing\]\s*\nverify_jwt\s*=\s*false\s*$/m);
  assert.equal((config.match(/verify_jwt\s*=\s*false\s*$/gm) ?? []).length, 1);
  assert.doesNotMatch(config, /WOMPI_(?:EVENTS|INTEGRITY)_SECRET\s*=/);
});

test('a public billing function still authenticates checkout and verifies webhook events', () => {
  const entry = read('supabase/functions/billing/index.ts');
  const handler = read('supabase/functions/_shared/billing-handler.ts');
  assert.match(entry, /Deno\.serve\(createBillingHandler\(/);
  assert.match(handler, /const webhook = new URL\(req\.url\)\.pathname\.endsWith\('\/events'\)/);
  assert.match(handler, /if \(!await authenticEvent\(body, config, req\.headers\.get\('x-event-checksum'\)\)\)/);
  assert.match(handler, /if \(!token \|\| !await deps\.getUser\(token\)\)/);
  assert.match(handler, /deps\.fetchTransaction\(tx\.id, config\.environment\)/);
});

const config = {
  environment:'sandbox', eventsSecret:'test_events_fixture_never_real',
  integritySecret:'test_integrity_fixture_never_real', publicKey:'pub_test_fixture',
  appUrl:'https://app.inmojco.com/', allowedOrigins:['https://app.inmojco.com']
};
const actions=[];
const handler=createBillingHandler(config,{
  getUser:async()=>null,
  createOrder:async()=>{actions.push('order');return {data:null,error:null}},
  fetchTransaction:async()=>{actions.push('transaction');return null},
  processEvent:async()=>{actions.push('event');return {data:null,error:null}}
});
function post(path,payload,extraHeaders={}){
  return handler(new Request('https://example.supabase.co/functions/v1/billing/'+path,{
    method:'POST',headers:{'content-type':'application/json',...extraHeaders},
    body:JSON.stringify(payload)
  }));
}
test('unsigned webhook cannot trigger Wompi lookup, RPC or checkout', async()=>{
  actions.length=0;
  const status=(await post('events',{event:'transaction.updated',environment:'test'})).status;
  assert.equal(status,401);
  assert.deepEqual(actions,[]);
});
test('checkout without an authenticated user JWT cannot create payment order', async()=>{
  actions.length=0;
  const status=(await post('checkout',{organizationId:'untrusted'})).status;
  assert.equal(status,401);
  assert.deepEqual(actions,[]);
});
test('sandbox event signature is distinct from checkout integrity hash',async()=>{
  assert.notEqual(await sha256('example'+config.eventsSecret),await sha256('example'+config.integritySecret));
});
