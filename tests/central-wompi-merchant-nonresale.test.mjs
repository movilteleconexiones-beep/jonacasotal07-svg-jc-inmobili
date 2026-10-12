import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createBillingHandler } from '../supabase/functions/_shared/billing-handler.ts';

const billing = readFileSync(new URL('../src/modules/billing/BillingModule.tsx', import.meta.url), 'utf8');
const license = readFileSync(new URL('../src/modules/license/LicenseModule.tsx', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../supabase/functions/billing/index.ts', import.meta.url), 'utf8');
const handler = readFileSync(new URL('../supabase/functions/_shared/billing-handler.ts', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../docs/central-wompi-and-nonresale-license-contract.md', import.meta.url), 'utf8');

test('license and billing pages explicitly forbid tenant software distribution', () => {
  for (const label of ['revender', 'sublicenciar', 'redistribuir']) {
    assert.ok(billing.includes(label), 'Billing copy must mention ' + label);
  }
  for (const label of ['revender licencias', 'sublicenciar', 'redistribuir', 'marca blanca']) {
    assert.ok(license.includes(label), 'License copy must mention ' + label);
  }
  for (const field of [
    'resale_allowed', 'sublicensing_allowed', 'redistribution_allowed',
    'white_label_allowed', 'copyright_transferred',
  ]) {
    assert.ok(license.includes(field), 'License must show existing rights ' + field);
    assert.ok(contract.includes(field), 'Policy must lock down ' + field);
  }
});

test('server owns Wompi merchant keys; checkout never loads a tenant merchant key', () => {
  assert.match(edge, /Deno\.env\.get\('WOMPI_PUBLIC_KEY'\)/);
  assert.match(edge, /Deno\.env\.get\('WOMPI_EVENTS_SECRET'\)/);
  assert.match(edge, /Deno\.env\.get\('WOMPI_INTEGRITY_SECRET'\)/);
  assert.match(handler, /'public-key': config\.publicKey/);
  assert.doesNotMatch(handler, /'public-key': body\./);
  assert.match(handler, /target_org: body\.organizationId/);
  assert.match(contract, /Un solo comercio de Wompi/);
});

test('tenant-submitted merchant options cannot change central Wompi checkout recipient', async () => {
  const origin = 'https://app.inmojco.com';
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const planId = '22222222-2222-4222-8222-222222222222';
  const requestKey = '33333333-3333-4333-8333-333333333333';
  let issued = 0;
  let argsUsed;
  const handlerFn = createBillingHandler({
    environment: 'sandbox',
    publicKey: 'pub_test_platform_owner_only',
    eventsSecret: 'test_only_events_secret_123456',
    integritySecret: 'test_only_integrity_secret_123456',
    appUrl: origin,
    allowedOrigins: [origin],
  }, {
    async getUser(token) {
      assert.equal(token, 'test_only_bearer_token');
      return '44444444-4444-4444-8444-444444444444';
    },
    async createOrder(_token, args) {
      issued++;
      argsUsed = args;
      return {
        data: {
          id: '55555555-5555-4555-8555-555555555555',
          reference: 'JCO_CENTRAL_TEST_01',
          amount_in_cents: 150000,
          currency: 'COP',
          status: 'PENDING',
          expires_at: '2030-01-01T00:00:00.000Z',
        },
        error: null,
      };
    },
    async processEvent() { throw new Error('Not called'); },
    async fetchTransaction() { throw new Error('Not called'); },
  });
  const response = await handlerFn(new Request(
    'https://edge.test/functions/v1/billing/checkout', {
      method: 'POST',
      headers: {
        origin,
        authorization: 'Bearer test_only_bearer_token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId,
        planId,
        requestKey,
        merchantPublicKey: 'pub_test_tenant_controlled',
        merchantId: 'different-agency-merchant',
        commissionSplit: 100,
        resellerId: 'third-party-license-reseller',
      }),
    },
  ));
  assert.equal(response.status, 200);
  const payload = await response.json();
  const checkout = new URL(payload.checkoutUrl);
  assert.equal(checkout.origin, 'https://checkout.wompi.co');
  assert.equal(checkout.searchParams.get('public-key'), 'pub_test_platform_owner_only');
  assert.notEqual(checkout.searchParams.get('public-key'), 'pub_test_tenant_controlled');
  assert.equal(issued, 1);
  assert.deepEqual(argsUsed, {
    target_org: organizationId,
    target_plan: planId,
    target_environment: 'sandbox',
    request_key: requestKey,
  });
  assert.equal(checkout.searchParams.has('merchantId'), false);
  assert.equal(checkout.searchParams.has('resellerId'), false);
});
