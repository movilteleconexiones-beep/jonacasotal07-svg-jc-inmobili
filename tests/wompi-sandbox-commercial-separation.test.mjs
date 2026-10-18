import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paymentDisplayLabel } from '../src/core/payment-display.ts';

const order = (environment, status, fulfillment_status) => ({
  environment, status, fulfillment_status,
});

test('a signed sandbox APPROVED event never renders as a real sale', () => {
  for (const fulfillment of ['PENDING', 'REVIEW_REQUIRED', 'APPLIED']) {
    const label = paymentDisplayLabel(order('sandbox', 'APPROVED', fulfillment));
    assert.match(label, /Simulación/);
    assert.doesNotMatch(label, /Pago real|plan activado/);
  }
});

test('production order labels distinguish verified, fulfilled and pending', () => {
  assert.match(paymentDisplayLabel(order('production', 'APPROVED', 'APPLIED')), /plan activado/);
  assert.match(paymentDisplayLabel(order('production', 'APPROVED', 'REVIEW_REQUIRED')), /pendiente de revisión/);
  assert.match(paymentDisplayLabel(order('production', 'PENDING', 'PENDING')), /pendiente de confirmación/);
  assert.match(paymentDisplayLabel(order('production', 'DECLINED', 'NO_ACCESS')), /no aprobado/);
});

test('unknown payment environments fail closed in the UI', () => {
  assert.match(paymentDisplayLabel(order('testing', 'APPROVED', 'APPLIED')), /desconocido/);
});

test('billing module uses the trusted environment label helper', () => {
  const code = readFileSync(new URL('../src/modules/billing/BillingModule.tsx', import.meta.url), 'utf8');
  assert.match(code, /const paymentLabel = paymentDisplayLabel;/);
  assert.match(code, /Las transacciones Sandbox no cobran dinero real/);
});
