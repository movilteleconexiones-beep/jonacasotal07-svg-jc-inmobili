import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { privateEntryRecovery } from '../src/core/private-entry-recovery.ts';

const state = (pathname, search='', authenticated=false, authorized=false) =>
  privateEntryRecovery({pathname,search,authenticated,authorized});

test('a signed-out user can always enter /app or its trailing-slash form', () => {
  assert.equal(state('/app'), 'sign-in');
  assert.equal(state('/app/','?inmobiliaria=sistema-inmobiliario-jco'), 'sign-in');
  assert.equal(state('/app','?inmobiliaria=another-tenant',true,false), 'restore-membership');
});

test('a billing callback without a session prompts sign-in instead of loading a tenant catalog', () => {
  assert.equal(state('/','?billing=return'), 'sign-in');
  assert.equal(state('/','?billing=return&inmobiliaria=missing-tenant'), 'sign-in');
  assert.equal(state('/','?billing=return',true,false), 'restore-membership');
});

test('authorized sessions continue to the existing private dashboard', () => {
  assert.equal(state('/app','',true,true), null);
  assert.equal(state('/','?billing=return',true,true), null);
});

test('public pages and non-return billing values are not intercepted', () => {
  assert.equal(state('/',''), null);
  assert.equal(state('/','?billing=other'), null);
  assert.equal(state('/inmobiliaria/other-tenant','?billing=return'), null);
  assert.equal(state('/super-admin',''), null);
  assert.equal(state('/app','',false,true), null);
});

test('recovery is checked before public catalog failure and never alters billing/RLS', () => {
  const app = readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(app,/import \{ privateEntryRecovery \} from '\.\/core\/private-entry-recovery'/);
  assert.ok(app.indexOf('const recoveryState = privateEntryRecovery(')>app.indexOf('if (authLoading) {'));
  assert.ok(app.indexOf('const recoveryState = privateEntryRecovery(')>app.indexOf('isPrivateDashboardOpen || agencyWorkspaceRequired'));
  assert.ok(app.indexOf('if (recoveryState) {')<app.indexOf('if (tenantSlug && (!publicCatalog.brand || publicCatalog.loading)) {'));
  assert.match(app,/<AuthAccessButton showIdentity=\{false\} \/>/);
  assert.match(app,/Ir al panel privado/);
  assert.doesNotMatch(app,/setIsPlatformAdmin\(true\)/);
});
