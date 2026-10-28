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

test('first-stage approval editor keeps current storefront and cannot publish automatically', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261028172000_property_publication_approval_stage1.sql', import.meta.url), 'utf8');
  const module = readFileSync(new URL('../src/modules/properties/PropertiesModule.tsx', import.meta.url), 'utf8');
  const editor = readFileSync(new URL('../src/modules/properties/PropertyPublishingControls.tsx', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE public\.property_publications/);
  assert.match(migration, /published boolean NOT NULL DEFAULT false/);
  assert.match(migration, /CREATE TRIGGER revoke_unavailable_property_publication/);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.tenant_public_catalog/);
  assert.doesNotMatch(migration, /INSERT INTO public\.property_publications/i);
  assert.match(module, /<PropertyPublishingControls property=\{row\}/);
  assert.match(editor, /property_publications/);
  assert.match(editor, /property\.status!=='AVAILABLE'/);
});

test('public photo rendering only accepts vetted HTTPS publication URLs', () => {
  const hook = readFileSync(new URL('../src/core/use-public-tenant-catalog.ts', import.meta.url), 'utf8');
  assert.match(hook, /safePublicPropertyPhoto\(row\.image_url\)/);
});
