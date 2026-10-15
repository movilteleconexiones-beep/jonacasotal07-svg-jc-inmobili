import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/modules/dashboard/PrivateDashboard.tsx', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../src/core/auth-context.tsx', import.meta.url), 'utf8');

test('Panel and SuperAdmin remain distinct destinations', () => {
  assert.match(app, /setIsPrivateDashboardOpen\(true\)/);
  assert.match(app, /href="\/super-admin"/);
  assert.match(app, /'Mi portal' : 'Panel'/);
  assert.match(app, /aria-label=\{activeMembership\?\.roles\.length===1/);
  assert.doesNotMatch(app, /if \(activeMembership\) \{\s*setIsPrivateDashboardOpen\(true\);\s*\} else if \(isPlatformAdmin\) \{\s*window\.location\.assign\('\/super-admin'\)/);
});
test('tenant dashboard retains visible SuperAdmin shortcut and membership restrictions', () => {
  assert.match(dashboard, /isPlatformAdmin && <a href="\/super-admin"/);
  assert.match(dashboard, /activeMembership/);
  assert.match(dashboard, /memberships/);
  assert.match(dashboard, /selectOrganization/);
});
test('account membership is resolved from active records and platform role independently', () => {
  assert.match(auth, /\.eq\('status', 'ACTIVE'\)/);
  assert.match(auth, /\.from\('platform_admins'\)/);
  assert.match(auth, /activeMembership: AuthMembership \| null/);
  assert.match(auth, /isPlatformAdmin: boolean/);
});
