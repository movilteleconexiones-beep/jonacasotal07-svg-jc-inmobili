import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidMembership, resolveEffectivePermissions } from '../src/core/auth-policy.ts';

test('DENY always overrides ALLOW regardless of row order', () => {
  for (const effects of [['ALLOW', 'DENY'], ['DENY', 'ALLOW']]) {
    const overrides = effects.map((effect) => ({ effect, permissions: { key: 'properties.delete' } }));
    assert.deepEqual(resolveEffectivePermissions(['properties.delete', 'properties.read'], overrides).sort(), ['properties.read']);
  }
});

test('ALLOW grants a missing permission', () => {
  assert.deepEqual(resolveEffectivePermissions([], [{ effect: 'ALLOW', permissions: { key: 'properties.read' } }]), ['properties.read']);
});

test('membership identity and organization must match', () => {
  const row = { user_id: 'user-a', status: 'ACTIVE', organization_id: 'org-a', organizations: { id: 'org-a' } };
  assert.equal(isValidMembership(row, 'user-a'), true);
  assert.equal(isValidMembership(row, 'user-b'), false);
  assert.equal(isValidMembership({ ...row, status: 'INVITED' }, 'user-a'), false);
  assert.equal(isValidMembership({ ...row, organizations: { id: 'org-b' } }, 'user-a'), false);
  assert.equal(isValidMembership({ ...row, organizations: null }, 'user-a'), false);
});

test('Supabase array-shaped permission relations are accepted', () => {
  const overrides = [
    { effect: 'ALLOW', permissions: [{ key: 'properties.read' }] },
    { effect: 'DENY', permissions: [{ key: 'properties.delete' }] },
  ];
  assert.deepEqual(resolveEffectivePermissions(['properties.delete'], overrides), ['properties.read']);
});
