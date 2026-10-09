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

test('invalid signature does not reach store', async () => {
  let calls = 0;
  const store = { async processVerifiedEvent() { calls++; return 'processed'; } };
  const event = signed();
  event.data.transaction.amount_in_cents = 1;
  assert.equal((await handleWompiWebhook(event, secret, 'sandbox', store)).statusCode, 401);
  assert.equal(calls, 0);
});

test('verified APPROVED event is forwarded once to trusted store', async () => {
  const inputs = [];
  const store = { async processVerifiedEvent(input) { inputs.push(input); return 'processed'; } };
  const response = await handleWompiWebhook(signed(), secret, 'sandbox', store);
  assert.deepEqual(response, { statusCode: 200, result: 'processed' });
  assert.equal(inputs[0].reference, 'JCO_ORDER_1234');
  assert.equal(inputs[0].environment, 'sandbox');
});

test('PENDING does not reach store or activate anything', async () => {
  const store = { async processVerifiedEvent() { throw new Error('must not be called'); } };
  assert.deepEqual(await handleWompiWebhook(signed('PENDING'), secret, 'sandbox', store),
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
  assert.deepEqual(await handleWompiWebhook(signed(), secret, 'sandbox', store),
    { statusCode: 409, result: 'expired_order' });
});


test('identical verified webhook retries return duplicate without new approval', async () => {
  let calls = 0;
  const store = { async processVerifiedEvent() { calls++; return calls === 1 ? 'processed' : 'duplicate'; } };
  const event = signed();
  assert.deepEqual(await handleWompiWebhook(event, secret, 'sandbox', store),
    { statusCode: 200, result: 'processed' });
  assert.deepEqual(await handleWompiWebhook(event, secret, 'sandbox', store),
    { statusCode: 200, result: 'duplicate' });
  assert.equal(calls, 2);
});

test('valid event from production cannot be replayed into sandbox', async () => {
  let calls = 0;
  const store = { async processVerifiedEvent() { calls++; return 'processed'; } };
  const event = signed();
  event.environment = 'prod';
  assert.deepEqual(await handleWompiWebhook(event, secret, 'sandbox', store),
    { statusCode: 401, result: 'invalid_signature' });
  assert.equal(calls, 0);
});

test('same event with forged checksum header is rejected before storage', async () => {
  let calls = 0;
  const store = { async processVerifiedEvent() { calls++; return 'processed'; } };
  assert.deepEqual(await handleWompiWebhook(signed(), secret, 'sandbox', store, '0'.repeat(64)),
    { statusCode: 401, result: 'invalid_signature' });
  assert.equal(calls, 0);
});
