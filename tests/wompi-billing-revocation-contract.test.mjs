import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contract = readFileSync(new URL('../docs/wompi-billing-revocation-concurrency-contract.md', import.meta.url), 'utf8');
const draft = readFileSync(new URL('../supabase/migrations/0032_atomic_sandbox_payment_order_draft.sql', import.meta.url), 'utf8');

test('release gate explicitly covers all permission revocation races', () => {
  for (const token of ['member_permissions', 'member_roles', 'role_permissions', 'organization_members', 'DENY', 'suspension', 'role sharing', 'Session A', 'Session B']) {
    assert.ok(contract.includes(token), `Missing concurrency scenario: ${token}`);
  }
});

test('current atomic order draft remains blocked until serialization is implemented', () => {
  assert.match(contract, /Do not deploy 0032/);
  assert.match(contract, /not deployed/i);
  assert.match(draft, /has_org_permission\(p_organization_id,'billing\.manage'\)/);
  assert.doesNotMatch(draft, /pg_advisory_xact_lock/);
});
