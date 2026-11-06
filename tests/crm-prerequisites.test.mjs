import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/modules/leads/LeadsModule.tsx', import.meta.url), 'utf8');
const validator = readFileSync(new URL('../src/core/lead-validation.ts', import.meta.url), 'utf8');

test('CRM cannot submit a new lead without a valid current tenant contact', () => {
  assert.match(source, /validateLeadDraft\(/);
  assert.match(validator, /!input\.contactId \|\| !visibleContacts\.some\(row => row\.id === input\.contactId\)/);
  assert.match(validator, /input\.propertyId && !visibleProperties\.some\(row => row\.id === input\.propertyId\)/);
  assert.match(source, /disabled=\{!ready \|\| creating \|\| visibleContacts\.length === 0\}/);
  assert.match(source, /primero registra un contacto en Clientes y contactos/);
});
test('CRM ignores stale tenant fetches and clears previous tenant data', () => {
  assert.match(source, /const loadVersion = useRef\(0\)/);
  assert.match(source, /const version = \+\+loadVersion\.current/);
  assert.match(source, /setRows\(\[\]\); setContacts\(\[\]\); setProperties\(\[\]\)/);
  assert.match(source, /version !== loadVersion\.current \|\| currentOrganization\.current !== organizationId/);
  assert.match(source, /return \(\) => \{ \+\+loadVersion\.current; \}/);
  assert.match(source, /setContacts\(contactResult\.error \? \[\]/);
  assert.match(source, /setProperties\(propertyResult\.error \? \[\]/);
  assert.match(source, /const visibleRows = loadedOrganization === organizationId \? rows : \[\]/);
  assert.match(source, /const visibleContacts = loadedOrganization === organizationId \? contacts : \[\]/);
  assert.match(source, /const visibleProperties = loadedOrganization === organizationId \? properties : \[\]/);
});
test('CRM stage writes respect allowed statuses, permissions and tenant scope', () => {
  assert.match(source, /!isLeadStatus\(status\) \|\| !visibleRows\.some\(row => row\.id === id\)/);
  assert.match(validator, /ALLOWED_LEAD_STATUSES\.some\(code => code === value\)/);
  assert.match(source, /!can\(PERMISSIONS\.LEADS_EDIT\)/);
  assert.match(source, /\.update\(\{ status \}\)\.eq\('id', id\)\.eq\('organization_id', organizationId\)/);
  assert.match(source, /\.select\('id,status'\)\.maybeSingle\(\)/);
  assert.match(source, /if \(error \|\| !data \|\| data\.status !== status\)/);
});
