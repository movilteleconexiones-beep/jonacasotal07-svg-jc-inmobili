import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createBillingHandler, sha256 } from '../supabase/functions/_shared/billing-handler.ts';

const production = readFileSync(
  new URL('../supabase/functions/billing-production/index.ts', import.meta.url), 'utf8');
const sandbox = readFileSync(
  new URL('../supabase/functions/billing/index.ts', import.meta.url), 'utf8');
const billingUI = readFileSync(
  new URL('../src/modules/billing/BillingModule.tsx', import.meta.url), 'utf8');

function dependencies() {
  const seen = [];
  return {
    seen,
    getUser: async () => 'signed-in-qa',
    createOrder: async (_token, args) => {
      seen.push(args);
      return { data: { id:'qa-order', reference:'JCO_QA_ONLY_2026',
        amount_in_cents:10000, currency:'COP', status:'PENDING',
        expires_at:new Date(Date.now()+600000).toISOString() }, error:null };
    },
    fetchTransaction: async () => { throw Error('No external Wompi calls'); },
    processEvent: async () => { throw Error('No payment event processing'); },
  };
}

const liveCfg = { environment:'production', publicKey:'pub_prod_QA_ONLY',
  eventsSecret:'prod_events_QA_ONLY', integritySecret:'prod_integrity_QA_ONLY',
  appUrl:'https://www.inmojco.com/', allowedOrigins:['https://www.inmojco.com'] };

function req(path, body, origin='https://www.inmojco.com') {
  return new Request('https://example.invalid'+path,{
    method:'POST',
    headers:{'Content-Type':'application/json', Origin:origin,Authorization:'Bearer qa-session'},
    body:JSON.stringify(body),
  });
}

test('G12 LIVE edge uses only separately named production secrets and fails closed', () => {
  for (const name of [
    'WOMPI_PROD_PRIVATE_KEY', 'WOMPI_PROD_PUBLIC_KEY',
    'WOMPI_PROD_EVENTS_SECRET', 'WOMPI_PROD_INTEGRITY_SECRET',
  ]) {
    assert.ok(production.includes("Deno.env.get('" + name + "')"));
  }
  for (const prefix of ['prv_prod_', 'pub_prod_', 'prod_events_', 'prod_integrity_'])
    assert.ok(production.includes(prefix));
  assert.ok(production.includes("merchantConfigured ? eventsSecret : ''"));
  assert.ok(production.includes("merchantConfigured ? integritySecret : ''"));
  assert.ok(production.includes("merchantConfigured ? publicKey : ''"));
  assert.ok(production.includes("environment: 'production' as const"));
  assert.ok(production.includes("environment !== 'production'"));
  assert.ok(production.includes('production.wompi.co'));
  assert.ok(production.includes('async getUser(token)'));
  assert.ok(production.includes("Authorization: `Bearer ${token}`"));
  assert.ok(!production.includes("Deno.env.get('WOMPI_ENV')"));
  assert.ok(!production.includes("Deno.env.get('WOMPI_PRIVATE_KEY')"));
  assert.ok(!production.includes("Deno.env.get('WOMPI_PUBLIC_KEY')"));
  assert.ok(!production.includes('import.meta.env.VITE_'));
  assert.ok(production.includes("console.warn('G12_LIVE_MERCHANT_SECRETS_INVALID: '"));
  assert.ok(production.includes("missingNames.push('WOMPI_PROD_PRIVATE_KEY')"));
  assert.ok(production.includes("missingNames.push('WOMPI_PROD_PUBLIC_KEY')"));
  assert.ok(production.includes("missingNames.push('WOMPI_PROD_EVENTS_SECRET')"));
  assert.ok(production.includes("missingNames.push('WOMPI_PROD_INTEGRITY_SECRET')"));
  assert.ok(!production.includes('console.log(privateKey'));
  assert.ok(!production.includes('console.log(publicKey'));
  assert.ok(!production.includes('console.log(eventsSecret'));
  assert.ok(!production.includes('console.log(integritySecret'));
  assert.ok(production.includes("G12_LIVE_SECRET_DIAGNOSTIC: "));
  assert.ok(production.includes("'wrong_prefix' : 'absent'"));
  assert.ok(production.includes("name + '=' + (value ? 'wrong_prefix' : 'absent')"));
  assert.ok(!production.includes('console.warn(privateKey'));
  assert.ok(!production.includes('console.warn(eventsSecret'));
});

test('G12 test tenants never use the LIVE gateway and SQL remains the authority', () => {
  assert.ok(billingUI.includes("billing?.is_test ? 'billing/checkout' : 'billing-production/checkout'"));
  assert.ok(billingUI.includes('billing.is_test ? settings?.sandbox_enabled : settings?.production_enabled'));
  assert.ok(production.includes("client.rpc('billing_create_order', args)"));
  assert.ok(sandbox.includes("Deno.env.get('WOMPI_ENV') === 'production'"));
  assert.ok(sandbox.includes("Deno.env.get('WOMPI_PUBLIC_KEY')"));
});

test('G12 missing LIVE keys block checkout and webhooks before creating orders', async () => {
  const deps=dependencies();
  const unavailable=createBillingHandler({...liveCfg,eventsSecret:'',integritySecret:'',publicKey:''},deps);
  let r=await unavailable(req('/checkout', { organizationId:'11111111-1111-4111-8111-111111111111',
    planId:'11111111-1111-4111-8111-111111111112',
    requestKey:'11111111-1111-4111-8111-111111111113'}));
  assert.equal(r.status,503);
  assert.equal((await r.json()).error,'payments_not_configured');
  r=await unavailable(req('/events',{event:'transaction.updated'}));
  assert.equal(r.status,503);
  assert.equal(deps.seen.length,0);
});

test('G12 LIVE checkout always creates a production order, never a sandbox order', async () => {
  const deps=dependencies(),handler=createBillingHandler(liveCfg,deps);
  const r=await handler(req('/checkout',{ organizationId:'11111111-1111-4111-8111-111111111111',
    planId:'11111111-1111-4111-8111-111111111112',
    requestKey:'11111111-1111-4111-8111-111111111113'}));
  assert.equal(r.status,200);
  assert.equal(deps.seen.length,1);
  assert.equal(deps.seen[0].target_environment,'production');
  const body=await r.json();
  assert.equal(body.environment,'production');
  const link=new URL(body.checkoutUrl);
  assert.equal(link.origin,'https://checkout.wompi.co');
  assert.equal(link.searchParams.get('public-key'),liveCfg.publicKey);
  assert.equal(link.searchParams.get('redirect-url'),'https://www.inmojco.com/?billing=return');
});

test('G12 webhook rejects Sandbox environment and invalid production signatures', async () => {
  const deps=dependencies(),handler=createBillingHandler(liveCfg,deps);
  const transaction={id:'tx_qa_only',reference:'JCO_QA_ONLY_2026',
    amount_in_cents:10000,currency:'COP',status:'APPROVED'};
  const timestamp=1791670000;
  const properties=['transaction.id','transaction.status'];
  const checksum=await sha256(transaction.id+transaction.status+timestamp+liveCfg.eventsSecret);
  const body={event:'transaction.updated',environment:'test',data:{transaction},timestamp,
    signature:{properties,checksum}};
  let res=await handler(req('/events',body));
  assert.equal(res.status,401);
  body.environment='prod';
  body.signature.checksum='bad_signature';
  res=await handler(req('/events',body));
  assert.equal(res.status,401);
  assert.equal(deps.seen.length,0);
});

test('G12 unknown browser origin cannot reach checkout, even with valid bearer',async()=>{
  const deps=dependencies(),handler=createBillingHandler(liveCfg,deps);
  const res=await handler(req('/checkout',{},'https://evil.example.invalid'));
  assert.equal(res.status,403);
  assert.equal(deps.seen.length,0);
});
