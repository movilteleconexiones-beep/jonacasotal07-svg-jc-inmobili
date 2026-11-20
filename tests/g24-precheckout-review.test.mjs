import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const billing = readFileSync(new URL('../src/modules/billing/BillingModule.tsx', import.meta.url),'utf8');
const license = readFileSync(new URL('../src/modules/license/LicenseModule.tsx', import.meta.url),'utf8');

test('G24: checkout requires a per-plan deliberate non-prechecked acknowledgement', () => {
  assert.match(billing, /const \[purchaseSummaryAcknowledged, setPurchaseSummaryAcknowledged\] = useState\(false\)/);
  assert.match(billing, /setReviewPlanId\(plan\.id\);\s*setPurchaseSummaryAcknowledged\(false\)/);
  assert.match(billing, /reviewPlanId !== planId/);
  assert.match(billing, /!purchaseSummaryAcknowledged/);
  assert.match(billing, /!billing\?\.terms_accepted/);
  assert.match(billing, /!billing\.terms_accepted \|\| !purchaseSummaryAcknowledged/);
  assert.match(billing, /checked=\{purchaseSummaryAcknowledged\}/);
  assert.match(billing, /setPurchaseSummaryAcknowledged\(event\.target\.checked\)/);
  assert.match(billing, /setReviewPlanId\(null\)/);
});

test('G24: review discloses actual plan, final displayed price, frequency and seller before Wompi', () => {
  for (const fragment of [
    '<SoftwareSellerIdentity />',
    'money(Number(plan.price))',
    'plan.billing_cycle',
    'plan.max_users',
    'plan.max_properties',
    'Wompi Sandbox (sin cobro real)',
    'Wompi',
    'Resumen previo al pago del plan',
    'Este resumen no constituye factura de venta',
  ]) assert.ok(billing.includes(fragment), fragment);
  assert.match(billing, /onClick=\{\(\) => void checkout\(plan\.id\)\}/);
  assert.match(billing, /\{billing\.is_test \? 'Confirmar e ir a Wompi Sandbox'/);
});

test('G24: current license terms remain retrievable at linked destination', () => {
  assert.match(billing, /href="#terminos-licencia"/);
  assert.match(license, /<section id="terminos-licencia" className="space-y-5">/);
  assert.match(license, /terms\.terms_markdown/);
  assert.match(license, /terms\.version/);
  assert.match(license, /billing_accept_terms/);
});

test('G24: no checkout based only on browser redirect or user-supplied total', () => {
  assert.match(billing, /const gateway = billing\?\.is_test \? 'billing\/checkout' : 'billing-production\/checkout'/);
  assert.match(billing, /billing\.is_test \? settings\.sandbox_enabled : settings\.production_enabled/);
  assert.match(billing, /data\.checkoutUrl/);
  assert.doesNotMatch(billing, /amount_in_cents:\s*Number\(plan\.price\)/);
  assert.match(billing, /url\.origin !== 'https:\/\/checkout\.wompi\.co'/);
});
