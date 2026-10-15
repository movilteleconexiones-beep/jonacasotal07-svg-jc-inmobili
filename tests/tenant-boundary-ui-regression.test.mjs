import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const dashboard = read('src/modules/dashboard/PrivateDashboard.tsx');
const inventory = read('src/modules/properties/PropertiesModule.tsx');
const branding = read('src/core/use-tenant-branding.ts');
const auth = read('src/core/auth-context.tsx');

test('private dashboard names the selected authenticated agency, not a mutable branding field', () => {
  assert.match(dashboard, /aria-label="Inmobiliaria activa"[^>]*>\{activeMembership\.organization\.name\}<\/div>/);
  assert.match(dashboard, /\{activeMembership\.billing\.is_test \? 'Cuenta de prueba/);
  assert.match(dashboard, /\{activeMembership\.organization\.name\} · Cliente \/ propietario de inmueble/);
  assert.doesNotMatch(dashboard, /\{branding\.companyName\}<\/div>/);
});

test('private inventory is scoped to active membership organization ID on fetch and insert', () => {
  assert.match(inventory, /const organizationId = activeMembership\?\.organization\.id;/);
  assert.match(inventory, /supabase\.from\('properties'\)[\s\S]{0,210}\.eq\('organization_id',organizationId\)/);
  assert.match(inventory, /organization_id: organizationId/);
  assert.match(inventory, /supabase\.from\('leases'\)[\s\S]{0,180}\.eq\('organization_id',organizationId\)/);
  assert.match(dashboard, /<PropertiesModule\s*\/>/);
});

test('tenant branding and statistics are each fetched for the active agency only', () => {
  assert.match(branding, /const organizationId = activeMembership\?\.organization\.id/);
  assert.match(branding, /\.from\('organization_branding'\)[\s\S]{0,270}\.eq\('organization_id', organizationId\)/);
  assert.match(branding, /\.from\('organization_settings'\)[\s\S]{0,210}\.eq\('organization_id', organizationId\)/);
  for(const table of ['properties','contacts','leads','appointments','deals']){
    assert.match(dashboard, new RegExp("supabase\\.from\\('"+table+"'\\)[\\s\\S]{0,160}\\.eq\\('organization_id', organizationId\\)"));
  }
});

test('membership is always selected by authenticated user and requires an active role', () => {
  assert.match(auth, /\.eq\('user_id', userId\)\s*\.eq\('status', 'ACTIVE'\)/);
  assert.match(auth, /org\.id !== row\.organization_id \|\| !roles\.length\) continue;/);
  assert.match(auth, /rolesError \|\| !memberRoles/);
});
