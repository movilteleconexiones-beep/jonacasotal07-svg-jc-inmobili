import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import express from 'express';
import { createWompiWebhookRouter } from '../server/wompi-express-router.ts';

const secret = 'sandbox_test_events_secret_not_real';
const calls = [];
const app = express();
app.use(createWompiWebhookRouter({
  eventsSecret: secret, environment: 'sandbox',
  store: { async processVerifiedEvent(input) { calls.push(input); return 'processed'; } },
}));
const server = createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
after(() => server.close());
const url = `http://127.0.0.1:${server.address().port}/wompi/events`;

function signedEvent(status = 'APPROVED') {
  const transaction = { id: 'tx-1', reference: 'ORDER_TEST_01', amount_in_cents: 100000, currency: 'COP', status };
  const timestamp = 1234567890;
  const properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
  const checksum = createHash('sha256').update(transaction.id + transaction.status + transaction.amount_in_cents + timestamp + secret).digest('hex');
  return { event: 'transaction.updated', environment: 'test', data: { transaction }, timestamp, signature: { properties, checksum } };
}

test('rejects unsigned event without touching store', async () => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'transaction.updated' }) });
  assert.equal(r.status, 401);
  assert.equal(calls.length, 0);
});

test('accepts correctly signed approved sandbox event', async () => {
  const body = signedEvent();
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Event-Checksum': body.signature.checksum }, body: JSON.stringify(body) });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'APPROVED');
});

test('rejects unsupported media type', async () => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'not json' });
  assert.equal(r.status, 415);
});

test('rejects oversized JSON', async () => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(70000) }) });
  assert.equal(r.status, 413);
});

test('rejects invalid JSON', async () => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(r.status, 400);
});
