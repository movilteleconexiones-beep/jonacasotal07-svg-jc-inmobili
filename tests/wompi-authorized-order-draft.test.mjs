import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuthorizedSandboxOrderDraft } from '../server/wompi-authorized-order-draft.ts';

const org = '22222222-2222-4222-8222-222222222222';
const input = { organizationId: org, planCode: 'BASIC', colombiaDate: '2026-10-08' };
const granted = { authenticated: true, organizationId: org, organizationActive: true, activeMember: true, canManageBilling: true };

test('trusted active billing member may construct sandbox-only draft', () => {
  const draft = buildAuthorizedSandboxOrderDraft(input, granted);
  assert.equal(draft.organizationId, org);
  assert.equal(draft.environment, 'sandbox');
  assert.match(draft.reference, /^JCO_[a-f0-9]{32}$/);
});

test('rejects missing authentication, inactive tenant, inactive membership and missing permission', () => {
  for (const field of ['authenticated', 'organizationActive', 'activeMember', 'canManageBilling']) {
    assert.throws(() => buildAuthorizedSandboxOrderDraft(input, { ...granted, [field]: false }), /not authorized/);
  }
});

test('rejects cross-tenant authorization and invalid plans', () => {
  assert.throws(() => buildAuthorizedSandboxOrderDraft(input, { ...granted, organizationId: '33333333-3333-4333-8333-333333333333' }), /not authorized/);
  assert.throws(() => buildAuthorizedSandboxOrderDraft({ ...input, planCode: 'LIFETIME' }, granted));
});
