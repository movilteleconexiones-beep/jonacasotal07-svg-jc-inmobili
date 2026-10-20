import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePublicTenantSlug, tenantPublicPath } from '../src/core/public-tenant-route.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('two signed-in agencies on the same domain see their own root public storefront', () => {
  const data = { pathname: '/', search: '', configuredSlug: 'main-owner-agency' };
  assert.equal(resolvePublicTenantSlug({...data,membershipSlug:'agency-jco'}), 'agency-jco');
  assert.equal(resolvePublicTenantSlug({...data,membershipSlug:'agency-b'}), 'agency-b');
  assert.equal(resolvePublicTenantSlug({...data,membershipSlug:null}), 'main-owner-agency');
});

test('explicit cross-agency public link always remains that agency, never swaps to signed-in member', () => {
  assert.equal(resolvePublicTenantSlug({
    pathname:'/inmobiliaria/agency-b',
    search:'',
    membershipSlug:'agency-jco',
    configuredSlug:'main-owner-agency',
  }), 'agency-b');
  assert.equal(tenantPublicPath('agency-jco'), '/inmobiliaria/agency-jco');
});

test('public navigation does not publish signed-in account identity on a different agency storefront', () => {
  const app = read('src/App.tsx');
  const auth = read('src/components/AuthAccessButton.tsx');
  assert.match(app, /viewingAnotherAgency/);
  assert.match(app, /href=\{tenantPublicPath\(activeMembership\?\.organization\.slug \|\| ''\)\}/);
  assert.match(app, /<AuthAccessButton showIdentity=\{false\} \/>/);
  assert.match(app, /tenantSlug && !agencyHeroUrl/);
  assert.match(auth, /showIdentity && isPlatformAdmin/);
  assert.match(auth, /showIdentity && <div/);
});

test('external private portal references its own tenant and does not link to the root', () => {
  const portal = read('src/modules/portal/PortalHub.tsx');
  assert.match(portal, /tenantPublicPath\(activeMembership\?\.organization\.slug/);
  assert.match(portal, /\$\{storefrontPath\}#catalogo/);
  assert.match(portal, /\$\{storefrontPath\}\?consignar=1/);
  assert.match(portal, /Mi portal · \{activeMembership\?\.organization\.name/);
  assert.doesNotMatch(portal, /href="\/(?:#catalogo|\?consignar=1)"/);
  assert.doesNotMatch(portal, /Mi portal · INMOJCO/);
});

test('private agency and customer portal show selected organization, own logo and matching public link', () => {
  const dashboard = read('src/modules/dashboard/PrivateDashboard.tsx');
  assert.match(dashboard, /activeMembership\.organization\.name\} · Portal privado/);
  assert.match(dashboard, /logoUrl \? <img src=\{logoUrl\}/);
  assert.match(dashboard, /href=\{tenantPublicPath\(activeMembership\.organization\.slug\)\}/);
  assert.match(dashboard, /key=\{organizationId\}/);
});
