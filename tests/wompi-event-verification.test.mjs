import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyWompiEvent, getVerifiedWompiTransaction } from '../server/wompi-event-verification.ts';

const secret = 'test_events_not_a_real_secret';
const makeEvent = () => {
  const event = {
    event: 'transaction.updated',
    environment: 'test',
    data: { transaction: { id: 'tx-123', status: 'APPROVED', amount_in_cents: 150000, currency: 'COP', reference: 'JCO_ORDER_1234' } },
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '' },
    timestamp: 1700000000,
  };
  event.signature.checksum = createHash('sha256')
    .update('tx-123APPROVED150000' + event.timestamp + secret).digest('hex');
  return event;
};

test('accepts valid Wompi test event checksum and extracts transaction', () => {
  const event = makeEvent();
  assert.equal(verifyWompiEvent(event, secret, 'test'), true);
  assert.equal(getVerifiedWompiTransaction(event)?.reference, 'JCO_ORDER_1234');
});

test('rejects tampered amount, checksum and environment', () => {
  const tampered = makeEvent();
  tampered.data.transaction.amount_in_cents = 1;
  assert.equal(verifyWompiEvent(tampered, secret, 'test'), false);
  const event = makeEvent();
  assert.equal(verifyWompiEvent(event, secret, 'prod'), false);
  assert.equal(verifyWompiEvent(event, secret, 'test', '0'.repeat(64)), false);
});

test('rejects malformed signature property paths', () => {
  const event = makeEvent();
  event.signature.properties = ['transaction.__proto__.polluted'];
  assert.equal(verifyWompiEvent(event, secret, 'test'), false);
});
