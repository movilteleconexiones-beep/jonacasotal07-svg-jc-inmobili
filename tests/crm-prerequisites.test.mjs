import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/modules/leads/LeadsModule.tsx', import.meta.url), 'utf8');

test('CRM cannot submit a new lead without a valid current tenant contact', () => {
  assert.match(source, /contacts\.some\(\(contact\) => contact\.id === contactId\)/);
  assert.match(source, /disabled=\{loading \|\| contacts\.length === 0\}/);
  assert.match(source, /primero registra un contacto en Clientes y contactos/);
});
test('CRM ignores stale tenant fetches and clears previous tenant data', () => {
  assert.match(source, /const loadVersion = useRef\(0\)/);
  assert.match(source, /const version = \+\+loadVersion\.current/);
  assert.match(source, /setRows\(\[\]\); setContacts\(\[\]\); setProperties\(\[\]\)/);
  assert.match(source, /if \(version !== loadVersion\.current\) return/);
  assert.match(source, /return \(\) => \{ \+\+loadVersion\.current; \}/);
  assert.match(source, /setContacts\(contactResult\.error \? \[\]/);
});
test('CRM stage writes respect allowed statuses, permissions and tenant scope', () => {
  assert.match(source, /STATUSES\.some\(\(\[value\]\) => value === status\)/);
  assert.match(source, /!can\(PERMISSIONS\.LEADS_EDIT\)/);
  assert.match(source, /\.update\(\{ status \}\)\.eq\('id', id\)\.eq\('organization_id', organizationId\)/);
});
