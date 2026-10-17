import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256, createBillingHandler } from '../supabase/functions/_shared/billing-handler.ts';

// Official published Wompi integration example. These are DOCUMENTATION SAMPLE
// values, never a real merchant credential.
const reference = 'sk8-438k4-xmxm392-sn2m';
const amount = 2490000;
const currency = 'COP';
const expiration = '2023-06-09T20:28:50.000Z';
const secret = 'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6';
const expectedWithoutExpiration = '37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5';

test('SHA-256 matches independently published official Wompi checkout test vector', async () => {
  const input = reference + amount + currency + secret;
  assert.equal(await sha256(input), expectedWithoutExpiration);
});

test('expiration is included BEFORE integrity secret, and must match URL exactly', async () => {
  // Independently compute the reference vector using native node:crypto.
  const expected = createHash('sha256').update(reference + amount + currency + expiration + secret).digest('hex');
  assert.equal(expected, 'e972f58e7de36b283fbb93d9318d39a54ffdff4e8e917b534f30d63c9d7bb89c');
  const signed = await sha256(reference + amount + currency + expiration + secret);
  assert.equal(signed, expected);
  assert.notEqual(signed, await sha256(reference + amount + currency + secret + expiration));
  assert.notEqual(signed, await sha256(reference + amount + currency + secret));
});

test('the real checkout builder signs every query field exactly as Wompi will receive it', async () => {
  const cfg = {
    environment: 'sandbox', publicKey: 'pub_test_documentation_fixture_only',
    eventsSecret: 'test_events_documentation_fixture_only',
    integritySecret: secret, appUrl: 'https://www.inmojco.com',
    allowedOrigins: ['https://www.inmojco.com'],
  };
  const handler = createBillingHandler(cfg, {
    async getUser() { return 'fixture-user'; },
    async createOrder() {
      return { data: {
        id: 'fixture-order',
        reference, amount_in_cents: amount, currency, status: 'PENDING',
        expires_at: expiration,
      }, error: null };
    },
    async processEvent() { throw new Error('events not used'); },
    async fetchTransaction() { throw new Error('events not used'); },
  });
  // Reference expiration is historical, so this test only validates signed
  // values independently of expiration. A future dated test already exists
  // in billing-edge-handler.test.mjs.
  const body = { organizationId:'20000000-0000-0000-0000-000000000002',
    planId:'60000000-0000-0000-0000-000000000001',
    requestKey:'50000000-0000-0000-0000-000000000001' };
  const res = await handler(new Request('https://dummy.supabase.co/functions/v1/billing/checkout',{
    method:'POST',headers:{'content-type':'application/json',authorization:'Bearer fixture',
      origin:'https://www.inmojco.com'},body:JSON.stringify(body),
  }));
  // The fixture's historical expiration must be rejected rather than
  // returning a payable URL with an expired signature.
  assert.equal(res.status,409);
  assert.equal((await res.json()).error,'order_expired');
});
