import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agencyHeroCopy, parsePublicAgencyServices, AGENCY_SERVICE_PROMPT } from '../src/core/public-agency-content.ts';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('approved services are bounded and malformed public data is ignored', () => {
  const services = parsePublicAgencyServices([
    { title: '  Administración ', description: ' Consultar servicio ' },
    { title: '', description: 'No publicar' },
    { title: 42, description: 'No publicar' },
    null, [], {},
  ]);
  assert.deepEqual(services, [{ title: 'Administración', description: 'Consultar servicio' }]);
  assert.deepEqual(parsePublicAgencyServices(null), []);
  assert.equal(parsePublicAgencyServices(Array.from({ length: 20 }, (_, n) => ({title: 'Servicio ' + n, description: 'Detalle'}))).length, 8);
  assert.match(AGENCY_SERVICE_PROMPT, /todavía no ha publicado/);
});

test('unconfigured agency copy attributes public page to current organization only', () => {
  const brand = agencyHeroCopy('Inmobiliaria Ejemplo', undefined, undefined, 'Colombia');
  assert.match(brand.title, /Inmobiliaria Ejemplo/);
  assert.match(brand.description, /Inmobiliaria Ejemplo/);
  assert.doesNotMatch(brand.title + brand.description, /JCO|INMOJCO|garantizada|18 años/);
  assert.equal(agencyHeroCopy('Agencia', 'Mi título', 'Mi descripción', 'Colombia').title, 'Mi título');
});

test('tenant page uses its own copy, services and contact and hides central claims', () => {
  const app = source('src/App.tsx');
  assert.match(app, /agencyHeroCopy\(publicCompanyName/);
  assert.match(app, /tenantSlug \? agencyCopy\.title/);
  assert.match(app, /tenantSlug \? agencyCopy\.description/);
  assert.match(app, /tenantSlug \? \([\s\S]*?publicAgencyServices\.map/);
  assert.match(app, /!tenantSlug && <section id="inmobilearning"/);
  assert.match(app, /!tenantSlug && <a[\s\S]*?href="#inmobilearning"/);
  assert.match(app, /tenantSlug \? publicCompanyName : softwareBrand/);
  assert.match(app, /tenantSlug \? [`']Sitio público/);
  assert.match(app, /contactService/);
  assert.match(app, /<PatrimonialSimulator branding=\{branding\}/);
  assert.match(app, /<SubmitPropertyModal[\s\S]*?publicSiteSlug=\{tenantSlug\}/);
  assert.match(app, /tenantSlug && \(!publicCatalog\.brand \|\| publicCatalog\.loading\)/);
});

test('tenant settings publishes editable marketing copy only within active organization', () => {
  const settings = source('src/modules/settings/SettingsModule.tsx');
  assert.match(settings, /can\('settings\.edit'\)/);
  assert.match(settings, /organization_id: organizationId/);
  assert.match(settings, /public_headline: publicHeadline\.trim\(\)/);
  assert.match(settings, /public_description: publicDescription\.trim\(\)/);
  assert.match(settings, /public_services: publicServices\.map/);
  assert.match(settings, /Retirar servicio/);
});

test('public catalogue function exposes only public marketing keys and scoped data', () => {
  const sql = source('supabase/migrations/20261019205000_tenant_public_website_brand_and_services.sql');
  assert.match(sql, /'public_headline', b\.public_headline/);
  assert.match(sql, /'public_services', b\.public_services/);
  assert.match(sql, /jco_private\.operational_access\(o\.id\)/);
  assert.match(sql, /o\.slug=tenant_slug/);
  assert.match(sql, /o\.status='ACTIVE'/);
  assert.match(sql, /s\.enable_public_website IS TRUE/);
  assert.doesNotMatch(sql, /'software_name', b\.software_name/);
  assert.equal((sql.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((sql.match(/^COMMIT;$/gm) || []).length, 1);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\\.tenant_public_catalog/g) || []).length, 1);
  assert.match(sql, /ADD CONSTRAINT jco_public_services_array/);
  assert.match(sql, /ADD CONSTRAINT jco_public_hero_url_safe/);

});
