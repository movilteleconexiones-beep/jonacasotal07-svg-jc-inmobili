import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('platform admin identity comes from active server-side platform_admins record', () => {
  const auth = read('../src/core/auth-context.tsx');
  assert.match(auth, /from\('platform_admins'\)/);
  assert.match(auth, /\.eq\('user_id', userId\)/);
  assert.match(auth, /\.eq\('active',\s*true\)/);
  assert.match(auth, /SUPER_ADMIN/);
  assert.match(auth, /isPlatformAdmin/);
});

test('central JCO admin navigation is not available to ordinary tenants', () => {
  const access = read('../src/components/AuthAccessButton.tsx');
  const dashboard = read('../src/modules/dashboard/PrivateDashboard.tsx');
  const admin = read('../src/modules/platform/SuperAdminModule.tsx');
  assert.match(access, /isPlatformAdmin\s*\?/);
  assert.match(access, /\{showIdentity\s*&&\s*isPlatformAdmin\s*&&/);
  assert.match(dashboard, /\{isPlatformAdmin\s*&&\s*<a href="\/super-admin"/);
  assert.match(admin, /if\s*\(!user\s*\|\|\s*!isPlatformAdmin\)/);
});

test('unaccepted invitations are not loaded as active memberships', () => {
  const auth = read('../src/core/auth-context.tsx');
  assert.match(auth, /\.eq\('status',\s*'ACTIVE'\)/);
  assert.match(auth, /claim_my_invitations/);
});

test('failed membership queries must not be displayed as an empty account', () => {
  const auth = read('../src/core/auth-context.tsx');
  const access = read('../src/components/AuthAccessButton.tsx');
  assert.match(auth, /if \(error\) throw new Error/);
  assert.match(auth, /setAccessError\('No se pudieron consultar las inmobiliarias/);
  assert.match(access, /\{accessError && \(/);
  assert.match(access, /!accessError && \(/);
});

test('superadmin distinguishes uncontracted agencies from active contract types', () => {
  const admin = read('../src/modules/platform/SuperAdminModule.tsx');
  // The option is available even when there are no assigned contract modes.
  assert.match(admin, /<option value="NONE">Sin contrato<\/option>/);
  assert.match(admin, /billingFilter === 'NONE' \? !org\.billing_mode : org\.billing_mode === billingFilter/);
  assert.match(admin, /organizations\.some\(org => !org\.billing_mode\)/);
  assert.match(admin, /billingModes\.length === 0/);
  assert.match(admin, /Todavía no hay modalidades de contrato asignadas/);
  assert.match(admin, /Hay inmobiliarias sin contrato/);
  assert.match(admin, /billingModes\.map\(mode => <option key=\{mode\} value=\{mode\}>\{etiquetaES\(mode\)\}/);
  assert.match(admin, /if \(!user \|\| !isPlatformAdmin\)/);
});
