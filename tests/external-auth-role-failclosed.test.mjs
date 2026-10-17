import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {
  canUseTenantPermission,
  hasVerifiedOperationalRole,
  tenantAccessMode,
} from '../src/core/portal-access-mode.ts';

const auth = readFileSync(
  new URL('../src/core/auth-context.tsx', import.meta.url), 'utf8'
);
const entitled = ['clients.view', 'properties.view', 'rent_payments.view'];

test('external-only client receives no staff module privilege even on fully entitled plan', () => {
  const roles = [{key:'CLIENT'}];
  assert.equal(tenantAccessMode(roles).portalOnly, true);
  assert.equal(hasVerifiedOperationalRole(roles), false);
  for (const permission of entitled) {
    assert.equal(canUseTenantPermission(roles, entitled, permission), false);
  }
});

test('unverified, missing, or malformed roles fail closed', () => {
  for (const roles of [
    [],
    [{key:null}],
    [{key:undefined}],
    [{key:''}],
    [{key:'CLIENT'}, {key:null}],
    [{key:'CLIENT'}, {key:undefined}],
  ]) {
    assert.equal(hasVerifiedOperationalRole(roles), false);
    assert.equal(canUseTenantPermission(roles, entitled, 'properties.view'), false);
  }
});

test('a legitimate dual CLIENT+staff account retains permitted staff modules', () => {
  const roles = [{key:'CLIENT'}, {key:'AGENT'}];
  assert.equal(hasVerifiedOperationalRole(roles), true);
  assert.equal(canUseTenantPermission(roles, entitled, 'properties.view'), true);
  assert.equal(canUseTenantPermission(roles, entitled, 'users.delete'), false);
  assert.equal(canUseTenantPermission([{key:'ORGANIZATION_OWNER'}], entitled, 'clients.view'), true);
});

test('failed membership-role fetch is not silently converted into a valid client or admin profile', () => {
  assert.match(auth, /const \{ data: memberRoles, error: rolesError \} = await supabase/);
  assert.match(auth, /if \(rolesError \|\| !memberRoles\)/);
  assert.match(auth, /throw new Error\('No se pudieron verificar los roles de la inmobiliaria/);
  assert.match(auth, /\|\| !roles\.length\) continue/);
});

test('plan benefits never become client-only operational permissions', () => {
  assert.match(auth, /permissions: hasVerifiedOperationalRole\(roles\) \? billing\.permissions : \[\]/);
  assert.match(auth, /canUseTenantPermission\(activeMembership\.roles, activeMembership\.permissions, permission\)/);
});

test('failed refresh clears roles only if its auth generation is still current', () => {
  const failures = auth.match(/setMemberships\(\[\]\);\s*setActiveOrganizationId\(null\);\s*setIsPlatformAdmin\(false\);\s*setAccessError\('No se pudieron consultar las inmobiliarias\./g) ?? [];
  assert.equal(failures.length, 1,
    'one shared failure handler prevents an obsolete request from clearing a new session');
  assert.match(auth, /catch \(loadError\) \{\s*if \(authLoadGate\.current\.isCurrent\(generation\)\)/);
  assert.match(auth, /if \(authLoadGate\.current\.isCurrent\(generation\)\) setLoading\(false\)/);
});
