import assert from 'node:assert/strict';
import test from 'node:test';
import { BILLING_MANAGE_PERMISSION, hasExplicitBillingPermission } from '../server/wompi-billing-permission.ts';

test('only explicit billing.manage permits billing action', () => {
  assert.equal(BILLING_MANAGE_PERMISSION, 'billing.manage');
  assert.equal(hasExplicitBillingPermission(['billing.manage']), true);
  assert.equal(hasExplicitBillingPermission(['settings.edit', 'roles.assign']), false);
  assert.equal(hasExplicitBillingPermission(['billing.view']), false);
  assert.equal(hasExplicitBillingPermission([]), false);
  assert.equal(hasExplicitBillingPermission(null), false);
  assert.equal(hasExplicitBillingPermission(undefined), false);
});
