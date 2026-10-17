import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const form = readFileSync(
  new URL('../src/modules/properties/PropertyPublishingControls.tsx', import.meta.url),
  'utf8',
);

test('switching properties or organizations invalidates older publication reads', () => {
  assert.match(form, /useRef\(0\)/);
  assert.match(form, /\+\+requestGeneration\.current;\s*setOpen\(false\)/);
  assert.match(form, /return\(\)=>\{\+\+requestGeneration\.current;\}/);
  assert.match(form, /const generation=\+\+requestGeneration\.current;/);
  assert.match(form, /if\(generation!==requestGeneration\.current\)return;\s*if\(error\)/);
  assert.match(form, /\[organizationId,property\.id\]/);
});

test('a late save cannot overwrite editor state after changing tenants', () => {
  assert.match(form, /const generation=requestGeneration\.current;/);
  assert.match(form, /\.eq\('organization_id',organizationId\)\.eq\('property_id',property\.id\)/);
  assert.match(form, /organization_id:organizationId,published,/);
  assert.match(form, /if\(generation!==requestGeneration\.current\)return;\s*setBusy\(false\)/);
  assert.match(form, /onClick=\{\(\)=>\{\+\+requestGeneration\.current;setOpen\(false\);\}\}/);
  assert.match(form, /can\(PERMISSIONS\.PROPERTIES_EDIT\)/);
});

test('published metadata remains a private staff-only database write', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261015194000_isolated_real_property_publications.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /CREATE POLICY publication_staff_update/);
  assert.match(migration, /jco_private\.is_internal_staff\(organization_id\)/);
  assert.match(migration, /public\.has_org_permission\(organization_id,'properties\.edit'\)/);
  assert.match(migration, /published boolean NOT NULL DEFAULT false/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE|ALL) ON public\.property_publications TO anon/);
});
