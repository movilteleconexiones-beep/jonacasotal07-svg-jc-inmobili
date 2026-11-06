import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isLeadStatus, validateLeadDraft } from '../src/core/lead-validation.ts';

const ui = readFileSync(new URL('../src/modules/leads/LeadsModule.tsx',import.meta.url),'utf8');
const a={contactId:'contact-a',propertyId:'property-a',minBudget:1800000,maxBudget:2300000};
const contacts=[{id:'contact-a'}],properties=[{id:'property-a'}];

test('CRM preflight rejects foreign-tenant or missing contacts and properties',()=>{
  assert.equal(validateLeadDraft(a,contacts,properties),null);
  assert.match(validateLeadDraft(a,[{id:'contact-b'}],properties)??'',/contacto válido de esta inmobiliaria/);
  assert.match(validateLeadDraft(a,contacts,[{id:'property-b'}])??'',/propiedad válida de esta inmobiliaria/);
  assert.match(validateLeadDraft({...a,contactId:''},contacts,properties)??'',/contacto válido/);
  assert.equal(validateLeadDraft({...a,propertyId:''},contacts,[]),null);
});

test('CRM budgets fail closed for inverted, invalid or negative values',()=>{
  for (const budget of [
    {...a,minBudget:2300001},
    {...a,minBudget:-1},
    {...a,maxBudget:-1},
    {...a,minBudget:Number.NaN},
    {...a,maxBudget:Number.POSITIVE_INFINITY},
  ])assert.match(validateLeadDraft(budget,contacts,properties)??'',/El presupuesto debe ser válido/);
  assert.equal(validateLeadDraft({...a,minBudget:0,maxBudget:0},contacts,properties),null);
  assert.equal(validateLeadDraft({...a,minBudget:null,maxBudget:null},contacts,properties),null);
});

test('CRM status values remain internal codes, never accepts forged status',()=>{
  for(const s of ['NEW','CONTACTED','QUALIFIED','VISIT_SCHEDULED','NEGOTIATION','WON','LOST'])
    assert.equal(isLeadStatus(s),true,s);
  for(const s of ['PAID','RENT','WON; DROP TABLE leads','won',''])
    assert.equal(isLeadStatus(s),false,s);
});

test('previous organization must not render after tenant switch, even before useEffect',()=>{
  for(const matcher of [
    /const visibleRows = loadedOrganization === organizationId \? rows : \[\]/,
    /const visibleContacts = loadedOrganization === organizationId \? contacts : \[\]/,
    /const visibleProperties = loadedOrganization === organizationId \? properties : \[\]/,
    /const version = \+\+loadVersion\.current/,
    /version !== loadVersion\.current \|\| currentOrganization\.current !== organizationId/,
    /return \(\) => \{ \+\+loadVersion\.current; \}/,
    /setRows\(\[\]\); setContacts\(\[\]\); setProperties\(\[\]\)/,
    /setLoadedOrganization\(null\)/,
    /for \(const row of visibleRows\)/,
    /\{visibleContacts\.map\(\(contact\) =>/,
    /\{visibleProperties\.map\(\(property\) =>/,
  ])assert.match(ui,matcher);
  assert.doesNotMatch(ui,/\{contacts\.map\(\(contact\) =>/);
});

test('new lead requires a valid tenant lookup and blocks overlapping writes',()=>{
  const creation=ui.slice(ui.indexOf('async function createLead('),ui.indexOf('async function updateStatus('));
  assert.match(creation,/if \(createInFlight\.current\) return/);
  assert.match(creation,/if \(!ready\)/);
  assert.match(creation,/validateLeadDraft\(/);
  assert.ok(creation.indexOf('validateLeadDraft(')<creation.indexOf(".from('leads').insert"));
  assert.match(creation,/createInFlight\.current = true;\s*setCreating\(true\)/);
  assert.match(creation,/finally \{\s*createInFlight\.current = false;\s*setCreating\(false\)/);
  assert.match(creation,/\.select\('id'\)\.single\(\)/);
  assert.match(creation,/if \(error \|\| !data\?\.id\)/);
  assert.match(creation,/antes de reintentar/);
  assert.match(creation,/const refreshed = await load\(\);/);
  assert.match(creation,/const formElement = event\.currentTarget/);
});

test('lead status confirms UPDATE returned a matching row scoped to this tenant',()=>{
  const change=ui.slice(ui.indexOf('async function updateStatus('),ui.indexOf('\n  return ('));
  assert.match(change,/if \(updateInFlight\.current\) return/);
  assert.match(change,/!isLeadStatus\(status\) \|\| !visibleRows\.some/);
  assert.match(change,/\.eq\('id', id\)\.eq\('organization_id', organizationId\)/);
  assert.match(change,/\.select\('id,status'\)\.maybeSingle\(\)/);
  assert.match(change,/if \(error \|\| !data \|\| data\.status !== status\)/);
  assert.match(change,/No se pudo confirmar el estado del prospecto/);
  assert.match(ui,/disabled=\{updatingId !== null\}/);
  assert.match(ui,/disabled=\{!ready \|\| creating \|\| visibleContacts\.length === 0\}/);
  assert.doesNotMatch(ui,/setMessage\(error\.message\)/);
});
