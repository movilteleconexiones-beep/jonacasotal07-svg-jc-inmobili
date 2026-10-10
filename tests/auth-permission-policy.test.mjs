import assert from 'node:assert/strict';
import { test } from 'node:test';

function resolvePermissions(rolePermissions, overrides) {
  const permissions = new Set(rolePermissions);
  const deniedPermissions = new Set();
  for (const { key, effect } of overrides) {
    if (!key) continue;
    if (effect === 'DENY') deniedPermissions.add(key);
    if (effect === 'ALLOW') permissions.add(key);
  }
  for (const key of deniedPermissions) permissions.delete(key);
  return [...permissions].sort();
}

function acceptMembership(row, requestedUserId) {
  return row.user_id === requestedUserId &&
    row.status === 'ACTIVE' &&
    row.organizations?.id === row.organization_id;
}

test('DENY wins over ALLOW regardless of override order', () => {
  for (const overrides of [
    [{ key: 'properties.delete', effect: 'ALLOW' }, { key: 'properties.delete', effect: 'DENY' }],
    [{ key: 'properties.delete', effect: 'DENY' }, { key: 'properties.delete', effect: 'ALLOW' }],
  ]) {
    assert.deepEqual(resolvePermissions(['properties.read', 'properties.delete'], overrides), ['properties.read']);
  }
});

test('ALLOW adds an otherwise missing permission', () => {
  assert.deepEqual(resolvePermissions([], [{ key: 'properties.read', effect: 'ALLOW' }]), ['properties.read']);
});

test('foreign, inactive, or mismatched organization memberships are rejected', () => {
  const row = { user_id: 'user-a', status: 'ACTIVE', organization_id: 'org-a', organizations: { id: 'org-a' } };
  assert.equal(acceptMembership(row, 'user-a'), true);
  assert.equal(acceptMembership(row, 'user-b'), false);
  assert.equal(acceptMembership({ ...row, status: 'INVITED' }, 'user-a'), false);
  assert.equal(acceptMembership({ ...row, organizations: { id: 'org-b' } }, 'user-a'), false);
  assert.equal(acceptMembership({ ...row, organizations: null }, 'user-a'), false);
});
