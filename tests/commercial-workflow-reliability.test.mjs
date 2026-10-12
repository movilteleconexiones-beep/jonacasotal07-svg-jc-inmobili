import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modules = {
  contacts: readFileSync(new URL('../src/modules/contacts/ContactsModule.tsx', import.meta.url), 'utf8'),
  deals: readFileSync(new URL('../src/modules/deals/DealsModule.tsx', import.meta.url), 'utf8'),
  leads: readFileSync(new URL('../src/modules/leads/LeadsModule.tsx', import.meta.url), 'utf8'),
  commissions: readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx', import.meta.url), 'utf8'),
};

test('all four commercial forms retain the form reference before awaiting Supabase', () => {
  for (const [name, source] of Object.entries(modules)) {
    assert.match(source, /const formElement = event\.currentTarget;\s*const form = new FormData\(formElement\);/, name);
    assert.match(source, /formElement\.reset\(\);/, name);
    assert.doesNotMatch(source, /event\.currentTarget\.reset\(\);/, name);
    assert.ok(source.indexOf('const formElement = event.currentTarget;') < source.indexOf('.insert('), name);
  }
});

test('contacts and deals ignore stale requests after changing organization', () => {
  for (const name of ['contacts', 'deals']) {
    const source = modules[name];
    assert.match(source, /const loadVersion = useRef\(0\)/, name);
    assert.match(source, /const version = \+\+loadVersion\.current/, name);
    assert.match(source, /if \(version !== loadVersion\.current\) return/, name);
    assert.match(source, /return \(\) => \{ \+\+loadVersion\.current; \}/, name);
    assert.match(source, /setRows\(\[\]\)/, name);
    assert.match(source, /\.eq\('organization_id', organizationId\)/, name);
  }
  assert.match(modules.deals, /setRows\(\[\]\); setContacts\(\[\]\); setProperties\(\[\]\)/);
});

test('server errors are not presented as legitimate empty data', () => {
  assert.match(modules.contacts, /if \(error\) setMessage\('No se pudieron consultar los contactos/);
  assert.match(modules.deals, /if \(dealResult\.error\) \{\s*setDealListState\('error'\);\s*setMessage\('No se pudieron consultar los negocios/);
  assert.match(modules.deals, /setContacts\(contactResult\.error \? \[\]/);
  assert.match(modules.deals, /setProperties\(propertyResult\.error \? \[\]/);
});

test('tenant access and independent SuperAdmin routes are preserved', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../src/modules/dashboard/PrivateDashboard.tsx', import.meta.url), 'utf8');
  assert.match(app, /setIsPrivateDashboardOpen\(true\)/);
  assert.match(app, /href="\/super-admin"/);
  assert.match(dashboard, /isPlatformAdmin && <a href="\/super-admin"/);
});
