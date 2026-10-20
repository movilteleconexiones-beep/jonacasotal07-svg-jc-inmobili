import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTenantSlug, isValidTenantSlug, tenantPrivatePath } from '../src/core/tenant-links.ts';
import { tenantPublicPath } from '../src/core/public-tenant-route.ts';

const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('new agency name creates its own readable slug and canonical links',()=>{
  const slug=normalizeTenantSlug(' Inmobiliaria Niño & Compañía S.A.S. ');
  assert.equal(slug,'inmobiliaria-nino-compania-s-a-s');
  assert.equal(isValidTenantSlug(slug),true);
  assert.equal(tenantPublicPath(slug),'/inmobiliaria/'+slug);
  assert.equal(tenantPrivatePath(slug),'/app?inmobiliaria='+slug);
  assert.equal(isValidTenantSlug('hola/../jco'),false);
  assert.equal(tenantPrivatePath('hola/../jco'),'/app');
  assert.equal(isValidTenantSlug('a'),false);
  assert.equal(normalizeTenantSlug('  '),'');
});

test('registration proposes agency identifier but allows business owner to edit',()=>{
  const registration=read('src/components/OrganizationRegistration.tsx');
  assert.match(registration,/normalizeTenantSlug\(e\.target\.value\)/);
  assert.match(registration,/!slugEdited/);
  assert.match(registration,/isValidTenantSlug\(cleanSlug\)/);
  assert.match(registration,/tenantPublicPath\(slug\)/);
  assert.match(registration,/tenantPrivatePath\(slug\)/);
  assert.match(registration,/Continuar a planes y pago/);
});

test('private tenant URL uses authenticated membership and never authorizes by bare slug',()=>{
  const auth=read('src/core/auth-context.tsx');
  const app=read('src/App.tsx');
  assert.match(auth,/requestedMembership = requestedSlug === null/);
  assert.match(auth,/nextMemberships\.find\(m => m\.organization\.slug === requestedSlug\)/);
  assert.match(auth,/if \(requestedSlug !== null\) return requestedMembership\?\.organization\.id \?\? null/);
  assert.match(auth,/const membership = memberships\.find\(item => item\.organization\.id === organizationId\)/);
  assert.match(auth,/window\.history\.replaceState/);
  assert.match(app,/Acceso privado no autorizado/);
  assert.match(app,/tenantPrivatePath\(activeMembership\?\.organization\.slug \|\| ''\)/);
});

test('brand settings save synchronizes operational header and URL requires active owner',()=>{
  const settings=read('src/modules/settings/SettingsModule.tsx');
  const dash=read('src/modules/dashboard/PrivateDashboard.tsx');
  const branding=read('src/core/use-tenant-branding.ts');
  assert.match(settings,/role\.key === 'ORGANIZATION_OWNER'/);
  assert.match(settings,/supabase\.rpc\('set_organization_public_slug'/);
  assert.match(settings,/await refreshMemberships\(\)/);
  assert.match(settings,/tenantPrivatePath\(currentSlug\)/);
  assert.match(settings,/window\.confirm\(/);
  assert.match(dash,/href=\{tenantPrivatePath\(activeMembership\.organization\.slug\)\}/);
  assert.match(branding,/companyName: 'Mi inmobiliaria'/);
});

test('SQL function security definer checks owner identity, scopes writes, audits and validates slugs',()=>{
  const sql=read('supabase/migrations/20261020183000_owner_organization_public_slug.sql');
  assert.match(sql,/SECURITY DEFINER/);
  assert.match(sql,/auth\.uid\(\)/);
  assert.match(sql,/om\.user_id=auth\.uid\(\)/);
  assert.match(sql,/r\.key='ORGANIZATION_OWNER'/);
  assert.match(sql,/r\.organization_id=o\.id/);
  assert.match(sql,/o\.status='ACTIVE'/);
  assert.match(sql,/WHERE id=target_org/);
  assert.match(sql,/organization\.public_slug\.updated/);
  assert.match(sql,/REVOKE ALL ON FUNCTION .* FROM PUBLIC/);
  assert.match(sql,/GRANT EXECUTE .* TO authenticated/);
  assert.doesNotMatch(sql,/GRANT .* TO anon/);
});
