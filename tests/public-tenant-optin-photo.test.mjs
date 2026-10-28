import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safePublicPropertyPhoto } from '../src/core/public-property-photo.ts';

test('safe public listing photos require HTTPS and reject private/signed URLs', () => {
  assert.equal(safePublicPropertyPhoto('https://example.org/listing.jpg'), 'https://example.org/listing.jpg');
  for (const value of [
    'http://example.org/p.jpg',
    'javascript:alert(1)',
    '//example.org/a.jpg',
    'https://storage.local/storage/v1/object/sign/org-docs/contract.pdf?token=123',
    'https://example.org/jco-inventory-private/photo.jpg',
    'https://example.org/test.jpg?token=secret',
    'https://user:pwd@example.org/photo.jpg',
    null, 42,
  ]) assert.equal(safePublicPropertyPhoto(value), '', String(value));
});

test('public catalogue RPC requires explicit publication and never returns private description', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261018174000_opt_in_public_property_catalog.sql', import.meta.url), 'utf8');
  const module = readFileSync(new URL('../src/modules/properties/PropertiesModule.tsx', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('../src/core/use-public-tenant-catalog.ts', import.meta.url), 'utf8');
  assert.match(migration, /JOIN public\.property_publications approved/);
  assert.match(migration, /approved\.published IS TRUE/);
  assert.match(migration, /'description', p\.public_description/);
  assert.match(migration, /'image_url', p\.public_photo_url/);
  assert.doesNotMatch(migration, /'description', p\.description/);
  assert.match(module, /<PropertyPublishingControls property=\{row\}/);
  assert.match(hook, /safePublicPropertyPhoto\(row\.image_url\)/);
});


test('opt-in publication RPC preserves current public brand/page contract', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261018174000_opt_in_public_property_catalog.sql', import.meta.url), 'utf8');
  const consumedByCurrentApp = [
    'public_headline',
    'public_description',
    'public_hero_url',
    'public_office_address',
    'public_services',
    'public_page_content',
    'whatsapp',
  ];
  for (const field of consumedByCurrentApp) {
    assert.ok(migration.includes("'" + field + "', b." + field),
      'publishing must preserve agency public branding: ' + field);
  }
  assert.match(migration,/JOIN public\.property_publications approved/);
  assert.match(migration,/approved\.published IS TRUE/);
  assert.match(migration,/prop\.status='AVAILABLE'/);
  assert.match(migration,/SET published=false/);
  assert.doesNotMatch(migration,/INSERT INTO public\.property_publications\s*\(/i);
});
