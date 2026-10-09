import assert from 'node:assert/strict';
import test from 'node:test';
import { JCO_APPROVED_PRICES_COP, getJcoTaxDecision } from '../src/core/jco-pricing-tax-policy.ts';

test('approved catalog contains exactly seven positive integer COP amounts', () => {
  assert.deepEqual(JCO_APPROVED_PRICES_COP, {
    BASIC: 104900, PRO: 194900, ENTERPRISE: 389900,
    BASIC_ANNUAL: 1039000, PRO_ANNUAL: 1949000,
    ENTERPRISE_ANNUAL: 3899000, LIFETIME: 6490000,
  });
  assert.ok(Object.values(JCO_APPROVED_PRICES_COP).every(Number.isSafeInteger));
});

test('2026 checkout price is final and includes applicable tax', () => {
  assert.deepEqual(getJcoTaxDecision('PRO','2026-12-31'), {
    kind:'2026_final_price', amountCop:194900, taxIncludedWhenApplicable:true,
  });
});

test('2027 does not invent VAT rate or authorize automatic charge', () => {
  assert.deepEqual(getJcoTaxDecision('PRO','2027-01-01'), {
    kind:'tax_configuration_required',baseAmountCop:194900,effectiveFrom:'2027-01-01',
  });
});

test('invalid dates are rejected', () => {
  assert.throws(() => getJcoTaxDecision('BASIC','2027-02-30'));
  assert.throws(() => getJcoTaxDecision('BASIC','2027-1-1'));
});
