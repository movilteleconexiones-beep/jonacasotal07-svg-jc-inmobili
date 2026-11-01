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
  assert.match(source, /if\(created\?\.id\) onCreated\?\.\(created\.id\)/);
  assert.match(source, /await load\(\);\s*setMessage\('Cliente\/contacto creado correctamente\.'\)/);
});

test('contact creation remains scoped to the inmobiliaria', () => {
  assert.match(source, /organization_id: organizationId/);
  assert.match(source, /\.eq\('organization_id', organizationId\)/);
  assert.doesNotMatch(source, /\.from\('contacts'\)\.upsert\(/);
});
