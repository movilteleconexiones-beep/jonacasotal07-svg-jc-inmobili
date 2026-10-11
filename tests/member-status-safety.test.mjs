import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const roles = readFileSync(new URL('../src/modules/users/UsersRolesModule.tsx', import.meta.url), 'utf8');

test('in-app membership changes cannot accidentally remove own access', () => {
  assert.match(roles, /member\.user_id === user\?\.id/);
  assert.match(roles, /Tu propia membresía está protegida/);
  assert.match(roles, /member\.status === 'ACTIVE'/);
});
test('last active organization owner remains protected in the UI', () => {
  assert.match(roles, /function isLastActiveOwner\(member: MemberRow\)/);
  assert.match(roles, /roles\?\.key === 'ORGANIZATION_OWNER'/);
  assert.match(roles, /if \(isLastActiveOwner\(member\)\)/);
  assert.match(roles, /isLastActiveOwner\(member\)\)\)\}/);
});
test('other membership status changes request explicit confirmation and are tenant scoped', () => {
  assert.match(roles, /window\.confirm\('¿Confirmas desactivar el acceso/);
  assert.match(roles, /\.update\(\{ status \}\)/);
  assert.match(roles, /\.eq\('organization_id', organizationId\)/);
  assert.match(roles, /!can\(PERMISSIONS\.USERS_EDIT\)/);
});
test('role chips remain assignments rather than a role switch', () => {
  assert.match(roles, /Los roles marcados se acumulan; no son un selector de vista/);
  assert.match(roles, /role\.key !== 'ORGANIZATION_OWNER'/);
});
