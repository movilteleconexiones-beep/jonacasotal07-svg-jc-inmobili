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
  assert.match(access, /\{isPlatformAdmin\s*&&/);
  assert.match(dashboard, /visible:\s*isPlatformAdmin/);
  assert.match(admin, /if\s*\(!user\s*\|\|\s*!isPlatformAdmin\)/);
});

test('unaccepted invitations are not loaded as active memberships', () => {
  const auth = read('../src/core/auth-context.tsx');
  assert.match(auth, /\.eq\('status',\s*'ACTIVE'\)/);
  assert.match(auth, /claim_my_invitations/);
});
