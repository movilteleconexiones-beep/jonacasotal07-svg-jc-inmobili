import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { handleWompiWebhook, isMatchingPendingOrder } from '../server/wompi-webhook-handler.ts';

const secret = 'fake_test_secret';
function signed(status = 'APPROVED') {
  const event = {
    event: 'transaction.updated',
    environment: 'test',
    data: { transaction: { id: 'tx123', status, reference: 'JCO_ORDER_1234', amount_in_cents: 99000, currency: 'COP' } },
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '' },
    timestamp: 1700000000,
  };
  event.signature.checksum = createHash('sha256').update('tx123' + status + '99000' + event.timestamp + secret).digest('hex');
  return event;
}

const providerLookup = async () => ({data: signed().data.transaction});


test('invalid signature does not reach store', async () => {
  let calls = 0;
  const store = { async processVerifiedEvent() { calls++; return 'processed'; } };
  const event = signed();
  event.data.transaction.amount_in_cents = 1;
  assert.equal((await handleWompiWebhook(event, secret, 'sandbox', store, providerLookup)).statusCode, 401);
  assert.equal(calls, 0);
});

test('verified APPROVED event is forwarded once to trusted store', async () => {
  const inputs = [];
  const store = { async processVerifiedEvent(input) { inputs.push(input); return 'processed'; } };
  const response = await handleWompiWebhook(signed(), secret, 'sandbox', store, providerLookup);
  assert.deepEqual(response, { statusCode: 200, result: 'processed' });
  assert.equal(inputs[0].reference, 'JCO_ORDER_1234');
  assert.equal(inputs[0].environment, 'sandbox');
});

test('PENDING does not reach store or activate anything', async () => {
  const store = { async processVerifiedEvent() { throw new Error('must not be called'); } };
  assert.deepEqual(await handleWompiWebhook(signed('PENDING'), secret, 'sandbox', store, providerLookup),
    { statusCode: 200, result: 'pending' });
});

test('order comparison rejects cross-environment and amount mismatch', () => {
  const order = { id: 'order1', reference: 'JCO_ORDER_1234', amountInCents: 99000, currency: 'COP', status: 'PENDING', environment: 'sandbox' };
  const input = { reference: 'JCO_ORDER_1234', transactionId: 'tx123', amountInCents: 99000, currency: 'COP', status: 'APPROVED', environment: 'sandbox' };
  assert.equal(isMatchingPendingOrder(order, input), true);
  assert.equal(isMatchingPendingOrder(order, { ...input, amountInCents: 1 }), false);
  assert.equal(isMatchingPendingOrder(order, { ...input, environment: 'production' }), false);
});


test('expired order remains a controlled conflict and never reports success', async () => {
  const store = { async processVerifiedEvent() { return 'expired_order'; } };
  assert.deepEqual(await handleWompiWebhook(signed(), secret, 'sandbox', store, providerLookup),
    { statusCode: 409, result: 'expired_order' });
});


test('identical verified webhook retries return duplicate without new approval', async () => {
  let calls = 0;
  const store = { async processVerifiedEvent() { calls++; return calls === 1 ? 'processed' : 'duplicate'; } };
  const event = signed();
  assert.deepEqual(await handleWompiWebhook(event, secret, 'sandbox', store, providerLookup),
    { statusCode: 200, result: 'processed' });
  assert.deepEqual(await handleWompiWebhook(event, secret, 'sandbox', store, providerLookup),
    { statusCode: 200, result: 'duplicate' });
  assert.equal(calls, 2);
});

test('valid event from production cannot be replayed into sandbox', async () => {
  let calls = 0;
  const store = { async processVerifiedEvent() { calls++; return 'processed'; } };
  const event = signed();
  event.environment = 'prod';
  assert.deepEqual(await handleWompiWebhook(event, secret, 'sandbox', store, providerLookup),
    { statusCode: 401, result: 'invalid_signature' });
  assert.equal(calls, 0);
});

test('same event with forged checksum header is rejected before storage', async () => {
  let calls = 0;
  const store = { async processVerifiedEvent() { calls++; return 'processed'; } };
  assert.deepEqual(await handleWompiWebhook(signed(), secret, 'sandbox', store, providerLookup, '0'.repeat(64)),
    { statusCode: 401, result: 'invalid_signature' });
  assert.equal(calls, 0);
});

test('unsigned order reference tampering is rejected before any license activation', async () => {
  let calls=0;
  const store={async processVerifiedEvent(){calls++;return 'processed';}};
  const event=signed();
  // Reference is NOT included in Wompi signature.properties.
  event.data.transaction.reference='JCO_OTHER_ORG_1234';
  const result=await handleWompiWebhook(event,secret,'sandbox',store,providerLookup);
  assert.deepEqual(result,{statusCode:409,result:'transaction_mismatch'});
  assert.equal(calls,0);
});

test('unsigned currency tampering is rejected by provider reconciliation', async () => {
  let calls=0;
  const store={async processVerifiedEvent(){calls++;return 'processed';}};
  const event=signed();
  // This signed example includes id/status/amount, but not currency.
  const lookup=async()=>({data:{...event.data.transaction,currency:'USD'}});
  assert.deepEqual(await handleWompiWebhook(event,secret,'sandbox',store,lookup),
    {statusCode:409,result:'transaction_mismatch'});
  assert.equal(calls,0);
});

test('provider outage or unconfigured private key cannot record a payment', async () => {
  let calls=0;
  const store={async processVerifiedEvent(){calls++;return 'processed';}};
  const lookup=async()=>{throw new Error('private lookup unavailable');};
  await assert.rejects(()=>handleWompiWebhook(signed(),secret,'sandbox',store,lookup),/private lookup unavailable/);
  assert.equal(calls,0);
});

test('provider mismatched status or amount cannot activate license', async () => {
  let calls=0;
  const store={async processVerifiedEvent(){calls++;return 'processed';}};
  for (const overrides of [{status:'DECLINED'},{amount_in_cents:99001}]) {
    const lookup=async()=>({data:{...signed().data.transaction,...overrides}});
    assert.deepEqual(await handleWompiWebhook(signed(),secret,'sandbox',store,lookup),
      {statusCode:409,result:'transaction_mismatch'});
  }
  assert.equal(calls,0);
});
