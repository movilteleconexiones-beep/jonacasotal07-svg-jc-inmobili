import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const module=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
test('cancellation and paid void requests require organizational administrator',()=>{
  const cancel=module.slice(module.indexOf('async function cancelCommission'),module.indexOf('async function requestPaidReview'));
  assert.match(cancel,/!isCommissionAdministrator/);
  const review=module.slice(module.indexOf('async function requestPaidReview'),module.indexOf('async function decideReview'));
  assert.match(review,/kind==='VOID'&&!isCommissionAdministrator/);
  assert.match(module,/isCommissionAdministrator && row.status !== 'CANCELLED'/);
});
test('paid operations remain audited and disallow self-approval',()=>{
  assert.match(module,/review.requested_by!==user\?\.id/);
  assert.match(module,/decide_paid_commission_review/);
  assert.match(module,/cancel_unpaid_commission/);
});
