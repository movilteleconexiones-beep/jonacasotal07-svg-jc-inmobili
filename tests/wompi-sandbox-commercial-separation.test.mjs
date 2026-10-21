import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paymentDisplayLabel, paymentReviewNotice } from '../src/core/payment-display.ts';

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

test('sandbox contractual review remains a simulation, with clear guidance', () => {
  const review = { ...order('sandbox','APPROVED','REVIEW_REQUIRED'), review_reason:'contract_review' };
  assert.match(paymentDisplayLabel(review), /requiere revisión, sin licencia comercial/);
  assert.match(paymentReviewNotice(review), /plan o contrato vigente/);
  assert.doesNotMatch(paymentDisplayLabel(review) + paymentReviewNotice(review), /Pago real confirmado|plan activado/);
});

test('review notices require a verified approval, not pending or unknown environments', () => {
  assert.equal(paymentReviewNotice({ ...order('sandbox','PENDING','REVIEW_REQUIRED'), review_reason:'contract_review' }), null);
  assert.equal(paymentReviewNotice({ ...order('testing','APPROVED','REVIEW_REQUIRED'), review_reason:'contract_review' }), null);
  assert.equal(paymentReviewNotice({ ...order('production','APPROVED','APPLIED'), review_reason:'contract_review' }), null);
  assert.match(paymentReviewNotice({ ...order('production','APPROVED','REVIEW_REQUIRED'), review_reason:'unexpected_external_data' }), /pendiente de revisión administrativa/);
  assert.match(paymentReviewNotice({ ...order('sandbox','APPROVED','REVIEW_REQUIRED'), review_reason:'license_review' }), /licencia previa/);
});

test('billing screen obtains review reason from tenant-scoped order history only', () => {
  const code = readFileSync(new URL('../src/modules/billing/BillingModule.tsx',import.meta.url),'utf8');
  assert.match(code, /select\('id,reference,status,fulfillment_status,review_reason,environment/);
  assert.match(code, /\.eq\('organization_id', orgId\)/);
  assert.match(code, /paymentReviewNotice\(order\)/);
});
