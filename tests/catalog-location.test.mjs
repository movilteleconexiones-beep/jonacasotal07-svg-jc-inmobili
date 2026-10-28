import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COLOMBIA_DIVIPOLA } from '../src/data/colombia-divipola.ts';
import { loadAdministrativeCatalog } from '../src/core/location-catalog.ts';
import { matchesCatalogLocation, matchesCatalogSearch } from '../src/core/catalog-location.ts';

test('the DANE snapshot covers every department, the capital, and all 1122 unique locations', () => {
  const regions = COLOMBIA_DIVIPOLA.regions;
  assert.deepEqual(regions.map(x => x.id).sort(), ['05','08','11','13','15','17','18','19','20','23','25','27','41','44','47','50','52','54','63','66','68','70','73','76','81','85','86','88','91','94','95','97','99']);
  const locations = regions.flatMap(region => region.localities);
  assert.equal(locations.length, 1122);
  assert.equal(new Set(locations.map(x => x.id)).size, 1122);
  for (const region of regions) {
    assert.ok(region.localities.length > 0);
    assert.ok(region.localities.every(x => /^\d{5}$/.test(x.id) && x.id.startsWith(region.id)));
  }
  assert.equal(regions.find(x => x.id === '27').localities.find(x => x.id === '27493').name, 'Nuevo Belén de Bajirá');
  assert.ok(regions.find(x => x.id === '11').localities.some(x => x.id === '11001'));
  assert.ok(regions.find(x => x.id === '94').localities.some(x => x.id === '94343'));
  assert.match(COLOMBIA_DIVIPOLA.attribution, /DANE.*CC BY-SA 4\.0/);
});

test('Colombia is available offline and needs no external catalog service', async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('offline'); };
  try {
    const catalog = await loadAdministrativeCatalog(' co ');
    assert.equal(catalog.regions.length, 33);
    assert.ok(catalog.regions.find(x => x.name === 'Antioquia').localities.some(x => x.name === 'Medellín'));
  } finally { globalThis.fetch = fetch; }
});

test('location filters match stored structured fields and reject homonymous cities in another department', () => {
  const select = { region: 'Nariño', locality: 'La Unión' };
  assert.equal(matchesCatalogLocation({ municipality: '', region: 'NARINO', city: 'LA UNION', countryCode: 'CO' }, 'CO', select), true);
  assert.equal(matchesCatalogLocation({ municipality: '', region: 'Valle del Cauca', city: 'La Unión' }, 'CO', select), false);
  assert.equal(matchesCatalogLocation({ municipality: '', region: 'Nariño', city: 'La Unión del Norte' }, 'CO', select), false);
  assert.equal(matchesCatalogLocation({ municipality: '', region: 'Nariño', city: 'La Unión', countryCode: 'MX' }, 'CO', select), false);
  assert.equal(matchesCatalogLocation({ municipality: 'Otra ciudad, Otra región', region: 'Nariño', city: 'La Unión' }, 'CO', select), true);
});

test('legacy municipality labels support department-only filters, Bogotá and accent-free names', () => {
  const medellin = { municipality: 'Medellín, Antioquia' };
  assert.equal(matchesCatalogLocation(medellin, 'CO', { region: 'Antioquia', locality: '' }), true);
  assert.equal(matchesCatalogLocation(medellin, 'CO', { region: 'Antioquia', locality: 'medellin' }), true);
  assert.equal(matchesCatalogLocation(medellin, 'CO', { region: 'Antioquia', locality: 'Envigado' }), false);
  assert.equal(matchesCatalogLocation({ municipality: 'Bogotá, D.C.' }, 'CO', { region: 'Bogotá, D.C.', locality: 'Bogota DC' }), true);
  assert.equal(matchesCatalogLocation({ municipality: 'Bogotá, D.C.' }, 'CO', { region: 'Cundinamarca', locality: '' }), false);
  assert.equal(matchesCatalogLocation({ municipality: '' }, 'CO', { region: '', locality: '' }), true);
  assert.equal(matchesCatalogLocation({ municipality: '' }, 'CO', { region: 'Antioquia', locality: '' }), false);
});

test('text search includes the city and department as well as the original property fields', () => {
  const property = { municipality: 'Medellín, Antioquia', city: '', region: '', title: 'Casa familiar', neighborhood: 'El Poblado', code: 'JCO-1084', architecturalSummary: 'Terraza abierta' };
  for (const query of ['medellin', 'ANTIOQUIA', 'el poblado', 'JCO-1084', 'terraza', '']) assert.equal(matchesCatalogSearch(property, query), true, query);
  assert.equal(matchesCatalogSearch(property, 'Cartagena'), false);
});

test('new agency in the same country resets storefront filters to reveal its inventory', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // This effect is deliberately scoped to BOTH the tenant URL and country;
  // a Colombian agency-to-agency navigation must not inherit previous filters.
  assert.match(app, /setOperationFilter\('Todas'\);\s*setCategoryFilter\('Todas'\);\s*setLocationFilter\(\{ region: '', locality: '' \}\);\s*setSearchQuery\(''\);\s*setSortBy\('featured'\);\s*\}, \[tenantSlug, countryProfile\.code\]\)/);

  const tenantBProperty = { countryCode: 'CO', municipality: 'Cali, Valle del Cauca' };
  const tenantASelection = { region: 'Antioquia', locality: 'Medellín' };
  assert.equal(matchesCatalogLocation(tenantBProperty, 'CO', tenantASelection), false);
  assert.equal(matchesCatalogLocation(tenantBProperty, 'CO', { region: '', locality: '' }), true);
});


test('city-only legacy Guarne is placed in Antioquia without changing production rows', () => {
  // Production may contain properties with city filled but department absent.
  const property = { municipality: 'guarne', region: '', city: 'guarne', countryCode: 'CO' };
  assert.equal(matchesCatalogLocation(property, 'CO', { region: 'Antioquia', locality: 'Guarne' }), true);
  assert.equal(matchesCatalogLocation(property, 'CO', { region: 'Antioquia', locality: '' }), true);
  assert.equal(matchesCatalogLocation(property, 'CO', { region: 'Cundinamarca', locality: 'Guarne' }), false);
  assert.equal(matchesCatalogLocation(property, 'CO', { region: '', locality: 'Guarne' }), true);
});

test('ambiguous names or explicit departments never infer a wrong Colombian location', () => {
  // La Unión exists in multiple Colombian departments. Do not guess.
  const ambiguous = { municipality: 'La Unión', region: '', city: 'La Unión', countryCode: 'CO' };
  assert.equal(matchesCatalogLocation(ambiguous, 'CO', { region: 'Nariño', locality: 'La Unión' }), false);
  assert.equal(matchesCatalogLocation(ambiguous, 'CO', { region: 'Valle del Cauca', locality: 'La Unión' }), false);

  const explicit = { municipality: 'Guarne, Cundinamarca', region: 'Cundinamarca', city: 'Guarne', countryCode: 'CO' };
  assert.equal(matchesCatalogLocation(explicit, 'CO', { region: 'Antioquia', locality: 'Guarne' }), false);

  const foreign = { municipality: 'Guarne', region: '', city: 'Guarne', countryCode: 'MX' };
  assert.equal(matchesCatalogLocation(foreign, 'CO', { region: 'Antioquia', locality: 'Guarne' }), false);
});
