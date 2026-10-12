import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/modules/deals/DealsModule.tsx', import.meta.url), 'utf8');

test('deals cannot be created without both a real customer and property option', () => {
  assert.match(source, /const hasRequiredOptions = contacts\.length > 0 && properties\.length > 0/);
  assert.match(source, /if \(!hasRequiredOptions \|\| loadingOptions\)/);
  assert.match(source, /contacts\.some\(\(item\) => item\.id === contactId\)/);
  assert.match(source, /properties\.some\(\(item\) => item\.id === propertyId\)/);
  assert.match(source, /disabled=\{!hasRequiredOptions \|\| loadingOptions \|\| busy\}/);
  assert.match(source, /Para registrar un negocio necesitas al menos un cliente y una propiedad/);
});

test('read failures never leave stale customer or property options from another organization', () => {
  assert.match(source, /setContacts\(\[\]\); setProperties\(\[\]\);/);
  assert.match(source, /setContacts\(contactResult\.error \? \[\]/);
  assert.match(source, /setProperties\(propertyResult\.error \? \[\]/);
});

test('deal writes require explicit tenant membership permissions and organization scoping', () => {
  assert.match(source, /!can\(PERMISSIONS\.DEALS_CREATE\)/);
  assert.match(source, /!can\(PERMISSIONS\.DEALS_EDIT\)/);
  assert.match(source, /\.update\(patch\)\s*\.eq\('id',id\)\.eq\('organization_id',organizationId\)\.select\('id'\)\.maybeSingle\(\)/);
  assert.match(source, /patch\.closed_at = stage === 'WON' \|\| stage === 'LOST' \? new Date\(\)\.toISOString\(\) : null/);
});
