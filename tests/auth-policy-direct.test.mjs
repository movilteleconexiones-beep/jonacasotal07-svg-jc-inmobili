import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eligibleRolesForOrganization, isValidMembership, resolveEffectivePermissions } from '../src/core/auth-policy.ts';

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

test('all permission keys in an array-shaped relation are processed', () => {
  const overrides = [
    { effect: 'DENY', permissions: [{ key: 'properties.delete' }, { key: 'properties.export' }] },
    { effect: 'ALLOW', permissions: [{ key: 'properties.read' }, { key: 'properties.export' }] },
  ];
  assert.deepEqual(
    resolveEffectivePermissions(['properties.delete', 'properties.export'], overrides),
    ['properties.read'],
  );
});

test('tenant role filter excludes roles from other organizations', () => {
  const entries = [
    { roles: { id: 'own', active: true, organization_id: 'org-a' } },
    { roles: [{ id: 'foreign', active: true, organization_id: 'org-b' }, { id: 'global', active: true, organization_id: null }] },
    { roles: { id: 'inactive', active: false, organization_id: 'org-a' } },
    { roles: null },
  ];
  assert.deepEqual(eligibleRolesForOrganization(entries, 'org-a').map((role) => role.id), ['own']);
  assert.deepEqual(eligibleRolesForOrganization(entries, 'org-b').map((role) => role.id), ['foreign']);
});

test('global and missing-organization roles never grant tenant permissions', () => {
  const entries = [
    { roles: { id: 'global', active: true, organization_id: null } },
    { roles: { id: 'missing-org', active: true } },
    { roles: { id: 'tenant-a', active: true, organization_id: 'org-a' } },
  ];
  assert.deepEqual(eligibleRolesForOrganization(entries, 'org-b'), []);
  assert.deepEqual(eligibleRolesForOrganization(entries, 'org-a').map((role) => role.id), ['tenant-a']);
});
