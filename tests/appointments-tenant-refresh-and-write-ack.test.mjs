import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isAppointmentStatus, validateAppointmentDraft } from '../src/core/appointment-validation.ts';

const source = readFileSync(new URL('../src/modules/appointments/AppointmentsModule.tsx',import.meta.url),'utf8');
const future='2035-06-10T14:00:00';
const later='2035-06-10T15:00:00';
const draft = { contactId:'tenant-a-contact', propertyId:'tenant-a-property', startsAt:future, endsAt:later };
const contacts=[{id:'tenant-a-contact'}];
const properties=[{id:'tenant-a-property'}];
const now = Date.UTC(2034, 0, 1);

test('valid appointment references must be chosen from the active tenant options',()=>{
  assert.equal(validateAppointmentDraft(draft,contacts,properties,now),null);
  assert.match(validateAppointmentDraft(draft,[{id:'tenant-b-contact'}],properties,now)??'',/cliente válido de esta inmobiliaria/);
  assert.match(validateAppointmentDraft(draft,contacts,[{id:'tenant-b-property'}],now)??'',/inmueble válido de esta inmobiliaria/);
  assert.equal(validateAppointmentDraft({...draft,contactId:'',propertyId:''},[],[],now),null);
});

test('appointment draft refuses invalid or past dates and inverted time windows',()=>{
  const checks=[
    {...draft,startsAt:'bad-date'},
    {...draft,startsAt:'2020-01-01T10:00:00'},
    {...draft,endsAt:'bad-date'},
    {...draft,endsAt:'2035-06-10T13:00:00'},
    {...draft,endsAt:'2035-06-10T14:00:00'},
  ];
  for(const value of checks) assert.match(
    validateAppointmentDraft(value,contacts,properties,now)??'',
    /Verifica las fechas/,
  );
});

test('status codes remain unchanged in the database, unexpected values are rejected',()=>{
  for(const value of ['SCHEDULED','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW'])
    assert.equal(isAppointmentStatus(value),true,value);
  for(const value of ['PAID','ACTIVE','DROP TABLE appointments','completed',''])
    assert.equal(isAppointmentStatus(value),false,value);
});

test('tenant switching blocks even a single render of appointments and foreign dropdown options',()=>{
  assert.match(source,/const visibleRows = loadedOrganization === organizationId \? rows : \[\]/);
  assert.match(source,/const visibleContacts = loadedOrganization === organizationId \? contacts : \[\]/);
  assert.match(source,/const visibleProperties = loadedOrganization === organizationId \? properties : \[\]/);
  assert.match(source,/const version = \+\+loadVersion\.current/);
  assert.match(source,/version !== loadVersion\.current \|\| currentOrganization\.current !== organizationId/);
  assert.match(source,/return \(\) => \{ \+\+loadVersion\.current; \}/);
  assert.match(source,/setRows\(\[\]\);\s*setContacts\(\[\]\);\s*setProperties\(\[\]\);\s*setLoadedOrganization\(null\)/);
  assert.match(source,/\{visibleRows\.map\(\(row\) => \(/);
  assert.match(source,/\{visibleContacts\.map\(\(contact\) =>/);
  assert.match(source,/\{visibleProperties\.map\(\(property\) =>/);
  assert.doesNotMatch(source,/\{rows\.map\(\(row\) =>/);
});

test('appointment creation validates the active tenant before the INSERT and is single-flight',()=>{
  const section=source.slice(source.indexOf('async function createAppointment('),source.indexOf('async function updateStatus('));
  assert.match(section,/if \(saveInFlight\.current \|\| saving\) return/);
  assert.match(section,/if \(!ready\)/);
  assert.match(section,/validateAppointmentDraft\([\s\S]*?visibleContacts, visibleProperties/);
  assert.ok(section.indexOf('validateAppointmentDraft(')<section.indexOf('.insert({'));
  assert.match(section,/saveInFlight\.current = true;\s*setSaving\(true\)/);
  assert.match(section,/finally \{\s*saveInFlight\.current = false;\s*setSaving\(false\)/);
  assert.match(section,/const formElement = event\.currentTarget/);
  assert.match(section,/\.insert\(\{[\s\S]*?\}\)\.select\('id'\)\.single\(\)/);
  assert.match(section,/if \(error \|\| !data\?\.id\)/);
  assert.match(section,/Actualiza la agenda y verifica si ya existe antes de reintentar/);
  assert.doesNotMatch(section,/event\.currentTarget\.reset\(\)/);
});

test('status changes acknowledge actual affected row and preserve tenant RLS query scope',()=>{
  const section=source.slice(source.indexOf('async function updateStatus('),source.indexOf('\n  return ('));
  assert.match(section,/if \(updateInFlight\.current\) return/);
  assert.match(section,/!isAppointmentStatus\(status\) \|\| !visibleRows\.some/);
  assert.match(section,/\.eq\('id', id\)\.eq\('organization_id', organizationId\)/);
  assert.match(section,/\.select\('id,status'\)\.maybeSingle\(\)/);
  assert.match(section,/if \(error \|\| !data \|\| data\.status !== status\)/);
  assert.match(section,/No se pudo confirmar el cambio de estado de la cita/);
  assert.match(source,/disabled=\{updatingId !== null\} onChange=/);
  assert.match(source,/disabled=\{!ready \|\| saving\} aria-busy=\{saving\}/);
});
