import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isPublicStorefrontPath, resolvePublicTenantSlug, tenantPublicPath,
} from '../src/core/public-tenant-route.ts';
import { shouldOpenAgencyWorkspace } from '../src/core/agency-workspace-entry.ts';

const slug = (pathname, search='', membershipSlug='own-agency', configuredSlug='') =>
  resolvePublicTenantSlug({pathname,search,membershipSlug,configuredSlug});

test('signed-in tenant can visit its public homepage and private /app independently',()=>{
  const session={authenticated:true,hasMembership:true,platformAdmin:false,publicConsignment:false};
  assert.equal(isPublicStorefrontPath('/'),true);
  assert.equal(isPublicStorefrontPath('/inmobiliaria/tenant-a'),true);
  assert.equal(isPublicStorefrontPath('/app'),false);
  assert.equal(shouldOpenAgencyWorkspace({...session,pathname:'/'}),false);
  assert.equal(shouldOpenAgencyWorkspace({...session,pathname:'/inmobiliaria/tenant-a'}),false);
  assert.equal(shouldOpenAgencyWorkspace({...session,pathname:'/app'}),true);
});

test('public links are tied to the URL, never the signed-in agency',()=>{
  assert.equal(slug('/inmobiliaria/tenant-b','', 'tenant-a'),'tenant-b');
  assert.equal(slug('/inmobiliaria/tenant-b/','', 'tenant-a'),'tenant-b');
  assert.equal(slug('/?not-a-route','?inmobiliaria=tenant-b','tenant-a'),'tenant-b');
  assert.equal(slug('/','?inmobiliaria=tenant-b','tenant-a'),'tenant-b');
  assert.equal(slug('/','','tenant-a'),'tenant-a');
  assert.equal(slug('/','','tenant-a','deployment-brand'),'tenant-a');
  assert.equal(slug('/','','','deployment-brand'),'deployment-brand');
  assert.equal(slug('/','?inmobiliaria=tenant-b','tenant-a','deployment-brand'),'tenant-b');
  assert.equal(slug('/inmobiliaria/tenant-b','','tenant-a','deployment-brand'),'tenant-b');
  assert.equal(tenantPublicPath(' Tenant-A '),'/inmobiliaria/tenant-a');
});

test('invalid tenant URLs fail closed and never show logged-in tenant instead',()=>{
  assert.equal(slug('/inmobiliaria/<script>','','tenant-a'),'');
  assert.equal(slug('/inmobiliaria/tenant-a/extra','','tenant-a'),'');
  assert.equal(slug('/inmobiliaria/tenant-a%2Fb','','tenant-a'),'');
  assert.equal(slug('/','?inmobiliaria=<bad>','tenant-a'),'');
  assert.equal(tenantPublicPath('../app'),'/');
  assert.equal(slug('/','?inmobiliaria=<bad>','own-agency','deployment-brand'),'');
});

test('public branded storefront is not replaced with operating dashboard',()=>{
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const privateUI=readFileSync(new URL('../src/modules/dashboard/PrivateDashboard.tsx',import.meta.url),'utf8');
  assert.match(app,/resolvePublicTenantSlug\(\{/);
  assert.match(app,/const explicitlyPublic = isPublicStorefrontPath\(/);
  assert.match(app,/!explicitlyPublic &&/);
  assert.match(app,/window\.location\.assign\(tenantPrivatePath\(activeMembership\?\.organization\.slug \|\| ''\)\)/);
  assert.match(app,/publicCatalog\.brand\?\.companyName/);
  assert.doesNotMatch(app,/const tenantSlug = activeMembership\?\.organization\.slug\s*\|\|/);
  assert.doesNotMatch(app,/\.\.\.memberBranding/);
  assert.match(privateUI,/href=\{tenantPublicPath\(activeMembership\.organization\.slug\)\}/);
  assert.match(privateUI,/Ver portada pública/);
  assert.match(app,/id="catalogo"/);
  assert.match(app,/id="servicios"/);
  assert.match(app,/id="contacto"/);
});
