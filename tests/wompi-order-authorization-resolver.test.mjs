import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareAuthorizedSandboxOrderDraft } from '../server/wompi-order-authorization-resolver.ts';

const userId = '44444444-4444-4444-8444-444444444444';
const orgId = '22222222-2222-4222-8222-222222222222';
const input = { organizationId: orgId, planCode: 'BASIC', colombiaDate: '2026-10-08' };
const allowed = { authenticated: true, organizationId: orgId, organizationActive: true, activeMember: true, canManageBilling: true };

test('trusted resolver receives verified identity and target tenant', async () => {
  let called = 0;
  const draft = await prepareAuthorizedSandboxOrderDraft(input, userId, {
    async resolve(identity) {
      called++;
      assert.deepEqual(identity, { userId, organizationId: orgId });
      return allowed;
    },
  });
  assert.equal(called, 1);
  assert.equal(draft.environment, 'sandbox');
});

test('missing verified identity never calls resolver', async () => {
  let called = 0;
  await assert.rejects(() => prepareAuthorizedSandboxOrderDraft(input, 'browser-provided', {
    async resolve() { called++; return allowed; },
  }), /Verified user required/);
  assert.equal(called, 0);
});

test('trusted denial and cross-tenant resolution fail closed', async () => {
  await assert.rejects(() => prepareAuthorizedSandboxOrderDraft(input, userId, {
    async resolve() { return { ...allowed, canManageBilling: false }; },
  }), /not authorized/);
  await assert.rejects(() => prepareAuthorizedSandboxOrderDraft(input, userId, {
    async resolve() { return { ...allowed, organizationId: '33333333-3333-4333-8333-333333333333' }; },
  }), /not authorized/);
});

test('resolver outage fails closed', async () => {
  await assert.rejects(() => prepareAuthorizedSandboxOrderDraft(input, userId, {
    async resolve() { throw new Error('database unavailable'); },
  }), /database unavailable/);
});
