import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/modules/contacts/ContactsModule.tsx', import.meta.url), 'utf8');

test('contact creation prevents repeated submits before React state is applied', () => {
  assert.match(source, /const createInFlight = useRef\(false\)/);
  assert.match(source, /if \(createInFlight\.current \|\| contactBusy\) return/);
  assert.match(source, /createInFlight\.current = true;\s*setContactBusy\(true\);\s*try/);
  assert.match(source, /finally \{\s*createInFlight\.current = false;\s*setContactBusy\(false\);/);
  assert.match(source, /<button type="submit" disabled=\{contactBusy\}/);
});

test('uncertain create result requests verification rather than blind retry', () => {
  assert.match(source, /No se confirmó el registro\. Actualiza y comprueba si el cliente existe antes de reintentar/);
  assert.match(source, /Ya existe una ficha con este correo/);
  assert.match(source, /if\s*\(created\?\.id\)\s*onCreated\?\.\(created\.id\)/);
  assert.match(source, /await load\(\);\s*if \(currentOrganization\.current === organizationId\)/);
});

test('contact creation remains scoped to the inmobiliaria', () => {
  assert.match(source, /organization_id: organizationId/);
  assert.match(source, /\.eq\('organization_id', organizationId\)/);
  assert.doesNotMatch(source, /\.from\('contacts'\)\.upsert\(/);
});

test('live duplicate lookup is scoped and fail closed before insert', () => {
  const duplicateLookup = source.indexOf(".ilike('email', literalEmailPattern)");
  const insert = source.indexOf(".from('contacts').insert(payload)");
  assert.ok(duplicateLookup > 0 && insert > duplicateLookup, 'read duplicate before inserting');
  assert.match(source, /literalEmailPattern = email\.replace\(/);
  assert.match(source, /\.eq\('organization_id', organizationId\)\s*\.ilike\('email', literalEmailPattern\)/);
  assert.match(source, /if \(duplicateError\)/);
  assert.match(source, /if \(duplicates\?\.length\)/);
  assert.match(source, /if \(currentOrganization\.current !== organizationId\) return/);
});

test('tenant switch prevents a stale contact from advancing another organization wizard', () => {
  assert.match(source, /currentOrganization\.current = organizationId/);
  assert.match(source, /setShowCreate\(false\);\s*void load\(\)/);
  const dbInsert = source.indexOf(".from('contacts').insert(payload)");
  const staleGuard = source.indexOf('if (currentOrganization.current !== organizationId) return;', dbInsert);
  const callback = source.indexOf('if (created?.id) onCreated?.(created.id);', dbInsert);
  assert.ok(staleGuard > dbInsert && callback > staleGuard);
});
