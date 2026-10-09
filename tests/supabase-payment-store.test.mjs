import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabasePaymentStore } from '../server/supabase-payment-store.ts';

const payment = {
  reference: 'JCO_ORDER_1234', transactionId: 'tx123', amountInCents: 99000,
  currency: 'COP', status: 'APPROVED', environment: 'sandbox',
};

test('verified payment is passed to server RPC with stable idempotency fingerprint', async () => {
  const calls = [];
  const store = createSupabasePaymentStore({
    async rpc(name, args) { calls.push({ name, args }); return { data: 'processed', error: null }; },
  });
  assert.equal(await store.processVerifiedEvent(payment), 'processed');
  assert.equal(await store.processVerifiedEvent(payment), 'processed');
  assert.equal(calls[0].name, 'process_verified_payment_event');
  assert.equal(calls[0].args.p_reference, payment.reference);
  assert.equal(calls[0].args.p_environment, 'sandbox');
  assert.match(calls[0].args.p_event_id, /^[a-f0-9]{64}$/);
  assert.equal(calls[0].args.p_event_id, calls[1].args.p_event_id);
});

test('database errors fail closed', async () => {
  const store = createSupabasePaymentStore({
    async rpc() { return { data: null, error: { message: 'database offline' } }; },
  });
  await assert.rejects(() => store.processVerifiedEvent(payment), /Payment processing failed/);
});

test('unexpected database response fails closed', async () => {
  const store = createSupabasePaymentStore({
    async rpc() { return { data: 'approved_anyway', error: null }; },
  });
  await assert.rejects(() => store.processVerifiedEvent(payment), /Unexpected/);
});


test('expired orders return manual-reconciliation status without success', async () => {
  const store = createSupabasePaymentStore({
    async rpc() { return { data: 'expired_order', error: null }; },
  });
  assert.equal(await store.processVerifiedEvent(payment), 'expired_order');
});
