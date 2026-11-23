import assert from 'node:assert/strict';
import test from 'node:test';
import { JCO_APPROVED_PRICES_COP, JCO_SELLER_RUT_2026, getJcoTaxDecision } from '../src/core/jco-pricing-tax-policy.ts';

test('approved catalog contains exactly seven positive integer COP amounts', () => {
  assert.deepEqual(JCO_APPROVED_PRICES_COP, {
    BASIC: 149900, PRO: 349900, ENTERPRISE: 389900,
    BASIC_ANNUAL: 1039000, PRO_ANNUAL: 1949000,
    ENTERPRISE_ANNUAL: 3899000, LIFETIME: 6490000,
  });
  assert.ok(Object.values(JCO_APPROVED_PRICES_COP).every(Number.isSafeInteger));
});

test('2026 RUT responsibility 49: do not collect or advertise IVA in seller totals', () => {
  assert.equal(JCO_SELLER_RUT_2026.responsibilityCode,'49');
  assert.equal(JCO_SELLER_RUT_2026.vatRegime,'NON_RESPONSIBLE');
  assert.deepEqual(getJcoTaxDecision('PRO','2026-12-31'), {
    kind:'2026_final_price', amountCop:349900,
    sellerVatRegime:'NON_RESPONSIBLE',vatChargedCop:0,
  });
});

test('2027 does not invent VAT rate or authorize automatic charge', () => {
  assert.deepEqual(getJcoTaxDecision('PRO','2027-01-01'), {
    kind:'tax_configuration_required',baseAmountCop:349900,effectiveFrom:'2027-01-01',
  });
});

test('invalid dates are rejected', () => {
  assert.throws(() => getJcoTaxDecision('BASIC','2027-02-30'));
  assert.throws(() => getJcoTaxDecision('BASIC','2027-1-1'));
});
