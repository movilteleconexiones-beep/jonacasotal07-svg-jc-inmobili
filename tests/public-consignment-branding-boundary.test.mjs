import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const modal=read('src/components/SubmitPropertyModal.tsx');
const site=read('src/lib/property-consignments.ts');
const catalog=read('src/pages/PublicAgencyCatalog.tsx');

test('public consignment branding is never inherited from authenticated private agency',()=>{
 assert.doesNotMatch(modal,/(?:import[^\n]*useTenantBranding|useTenantBranding\(|tenantBranding\.|\.from\('organization_branding'\))/);
 assert.match(modal,/usePublicPropertyIntakeSite\(isOpen,siteSlug\)/);
 assert.match(modal,/companyName:site\?\.company_name\|\|'la inmobiliaria'/);
 assert.match(modal,/country:site\?\.country\|\|'CO'/);
 assert.match(modal,/currency:site\?\.currency\|\|'COP'/);
 assert.match(modal,/submitPropertyConsignment\(site.slug,/);
});
test('public site slug is scoped per navigation, and mismatched RPC response is refused',()=>{
 assert.doesNotMatch(site,/^const publicSiteSlug =/m);
 assert.match(site,/publicConsignmentSlug\(\s*window.location.pathname/);
 assert.match(site,/const publicSiteSlug=requestedSiteSlug \?\? routeSlug/);
 assert.match(site,/data\?\.slug !== publicSiteSlug/);
 assert.match(site,/\[enabled, publicSiteSlug\]/);
 assert.match(site,/return \{ site: site\?\.slug === publicSiteSlug \? site : null/);
});
test('agency storefront fully remounts consignment form on public tenant change',()=>{
 assert.match(catalog,/<SubmitPropertyModal key=\{slug\} siteSlug=\{slug\|\|undefined\}/);
 assert.match(catalog,/supabase\.rpc\('get_public_property_intake_site',\{p_slug:slug\}\)/);
 assert.doesNotMatch(catalog,/useTenantBranding|activeMembership|\.from\('properties'\)/);
});
