import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteJcoSandboxOrder } from '../server/wompi-sandbox-order-quote.ts';

test('all six SaaS plans quote approved amounts in Wompi cents', () => {
  const expected = [
    ['BASIC',10490000,'SAAS_MONTHLY'],['PRO',19490000,'SAAS_MONTHLY'],
    ['ENTERPRISE',38990000,'SAAS_MONTHLY'],
    ['BASIC_ANNUAL',103900000,'SAAS_ANNUAL'],
    ['PRO_ANNUAL',194900000,'SAAS_ANNUAL'],
    ['ENTERPRISE_ANNUAL',389900000,'SAAS_ANNUAL'],
  ];
  for (const [code,amount,billingMode] of expected) {
    assert.deepEqual(quoteJcoSandboxOrder(code,'2026-10-08'),{
      planCode:code,billingMode,amountInCents:amount,currency:'COP',environment:'sandbox',
    });
  }
});

test('no lifetime checkout, client-supplied price or unknown plan', () => {
  assert.throws(()=>quoteJcoSandboxOrder('LIFETIME','2026-10-08'),/manual approval/);
  assert.throws(()=>quoteJcoSandboxOrder('BASIC_FAKE','2026-10-08'),/Unsupported/);
});

test('2027 checkout fails closed until VAT is configured', () => {
  assert.throws(()=>quoteJcoSandboxOrder('BASIC','2027-01-01'),/Tax configuration required/);
});
