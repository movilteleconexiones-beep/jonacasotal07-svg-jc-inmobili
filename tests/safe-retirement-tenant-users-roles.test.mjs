import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const platform=readFileSync(new URL('../src/modules/platform/SuperAdminModule.tsx',import.meta.url),'utf8');
const tenant=readFileSync(new URL('../src/modules/users/UsersRolesModule.tsx',import.meta.url),'utf8');
const auth=readFileSync(new URL('../src/core/auth-context.tsx',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../src/modules/dashboard/PrivateDashboard.tsx',import.meta.url),'utf8');

test('SuperAdmin suspends a named tenant via the existing server-audited billing RPC',()=>{
  assert.match(platform,/isPlatformAdmin/);
  assert.match(platform,/org\.organization_id === activeMembership\?\.organization\.id/);
  assert.match(platform,/org\.owner_user_id === user\.id/);
  assert.match(platform,/identifier !== org\.organization_slug/);
  assert.match(platform,/reason\.trim\(\)\.length < 10/);
  assert.match(platform,/\.rpc\('billing_admin_action', \{/);
  assert.match(platform,/action: 'SUSPEND'/);
  assert.match(platform,/target_org: org\.organization_id/);
  assert.match(platform,/Suspender acceso/);
  assert.match(platform,/conservarán sus datos/);
  assert.doesNotMatch(platform,/\.from\('organizations'\)\.delete\(/);
});

test('tenant membership access is deactivated only within its own organization',()=>{
  assert.match(tenant,/can\(PERMISSIONS\.USERS_EDIT\)/);
  assert.match(tenant,/member\.user_id === user\?\.id \|\| isLastActiveOwner\(member\)/);
  assert.match(tenant,/typed !== 'RETIRAR'/);
  assert.match(tenant,/\.from\('organization_members'\)\s*\.update\(\{ status: 'INACTIVE' \}\)/);
  assert.match(tenant,/\.eq\('id', member\.id\)\.eq\('organization_id', organizationId\)/);
  assert.match(tenant,/Retirar usuario/);
  assert.match(tenant,/Restablecer acceso/);
  assert.match(tenant,/Debe permanecer al menos un propietario activo de la inmobiliaria/);
  assert.doesNotMatch(tenant,/\.from\('organization_members'\)\s*\.delete\(/);
});

test('system roles cannot be retired; only tenant custom roles may be disabled',()=>{
  assert.match(tenant,/can\(PERMISSIONS\.ROLES_EDIT\) \|\| role\.is_system_role/);
  assert.match(tenant,/\.from\('roles'\)\s*\.update\(\{ active \}\)/);
  assert.match(tenant,/\.eq\('organization_id', organizationId\)\.eq\('is_system_role', false\)/);
  assert.match(tenant,/typed !== 'RETIRAR'/);
  assert.match(tenant,/Desactivar rol/);
  assert.match(tenant,/Reactivar rol/);
  assert.match(tenant,/role\.active && isTenantRole\(role\)/);
  assert.doesNotMatch(tenant,/\.from\('roles'\)\s*\.delete\(/);
});

test('original dual Panel/SuperAdmin role recognition and direct navigation remain unchanged',()=>{
  assert.match(auth,/\.from\('platform_admins'\)/);
  assert.match(auth,/\.from\('organization_members'\)/);
  assert.match(dashboard,/isPlatformAdmin && <a href="\/super-admin"/);
  assert.match(dashboard,/activeMembership/);
});
