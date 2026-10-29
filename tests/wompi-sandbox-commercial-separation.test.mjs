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


test('an applied test order displays active subscription independently from payment label', () => {
  const code = readFileSync(new URL('../src/modules/billing/BillingModule.tsx', import.meta.url), 'utf8');
  assert.match(code, /billing\.subscription_status === 'ACTIVE'/);
  assert.match(code, /plan\.id === activeMembership\?\.organization\.planId/);
  assert.match(code, /Plan \{activePlan\.name\} activo/);
  assert.match(code, /entorno de pruebas/);
  assert.match(code, /no representa dinero recibido ni una licencia comercial/);
  assert.match(code, /differentActivePlan/);
  assert.match(code, /Cambio de plan: requiere revisión/);
  assert.match(code, /window\.confirm\(/);
  assert.match(code, /Simular renovación/);
  assert.match(code, /onClick=\{\(\) => void checkout\(plan\.id\)\}/);
});

test('expired sandbox and production PENDING orders are not shown as awaiting a live checkout', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const expired = '2026-10-28T12:00:00Z';
  for (const env of ['sandbox', 'production']) {
    const item = { ...order(env, 'PENDING', 'PENDING'), expires_at: expired };
    const label = paymentDisplayLabel(item, now);
    assert.match(label, /vencid/);
    assert.doesNotMatch(label, /pendiente de confirmación|plan activado/);
    assert.match(paymentReviewNotice(item, now), /No se ha confirmado un cobro/);
  }
});

test('only expired PENDING orders get the expired label (never an approved order)', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const past = '2026-10-28T12:00:00Z';
  const future = '2026-11-01T12:00:00Z';
  for (const expires_at of [null, '', 'not-a-date', future]) {
    const pending = { ...order('sandbox', 'PENDING', 'PENDING'), expires_at };
    assert.match(paymentDisplayLabel(pending, now), /pendiente de confirmación/);
    assert.equal(paymentReviewNotice(pending, now), null);
  }
  const approved = { ...order('sandbox', 'APPROVED', 'APPLIED'), expires_at: past };
  assert.match(paymentDisplayLabel(approved, now), /Simulación aprobada/);
  assert.equal(paymentReviewNotice(approved, now), null);
  const production = { ...order('production', 'APPROVED', 'APPLIED'), expires_at: past };
  assert.match(paymentDisplayLabel(production, now), /Pago real confirmado/);
  assert.equal(paymentReviewNotice(production, now), null);
});

test('expiration is a display-only status and must be loaded from scoped order history', () => {
  const billing = readFileSync(new URL('../src/modules/billing/BillingModule.tsx', import.meta.url), 'utf8');
  const labels = readFileSync(new URL('../src/core/payment-display.ts', import.meta.url), 'utf8');
  assert.match(billing, /review_reason,environment,created_at,expires_at,amount_in_cents/);
  assert.match(billing, /\.eq\('organization_id', orgId\)/);
  assert.match(labels, /order\.status !== 'PENDING'/);
  assert.doesNotMatch(labels, /supabase|update\(|insert\(/);
});
