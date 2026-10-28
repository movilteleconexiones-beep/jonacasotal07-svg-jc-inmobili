import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PublicContactRequestScope } from '../src/core/public-contact-request-scope.ts';

test('switching agencies invalidates pending CRM replies, even within Colombia', () => {
  const guard = new PublicContactRequestScope();
  assert.equal(guard.update('agency-a', 'https://a.example/politica'), true);
  const oldRequest = guard.capture();
  assert.equal(guard.update('agency-b', 'https://b.example/politica'), true);
  assert.equal(guard.isCurrent(oldRequest), false);
  const current = guard.capture();
  assert.equal(guard.isCurrent(current), true);
  assert.equal(guard.update('AGENCY-B', 'https://b.example/politica'), false);
  assert.equal(guard.isCurrent(current), true);
});

test('a privacy-policy update requires new consent within the same agency', () => {
  const guard = new PublicContactRequestScope();
  guard.update('agency-a', 'https://agency.example/privacy/v1');
  const request = guard.capture();
  assert.equal(guard.update('agency-a', 'https://agency.example/privacy/v2'), true);
  assert.equal(guard.isCurrent(request), false);
  const changedPolicyRequest = guard.capture();
  assert.equal(guard.update('agency-a', null), true);
  assert.equal(guard.isCurrent(changedPolicyRequest), false);
  assert.equal(guard.update(null, null), true);
});

test('a delayed network reply cannot confirm a lead on the next agency site', async () => {
  const guard = new PublicContactRequestScope();
  guard.update('agency-a', 'https://agency-a.example/privacy');
  const original = guard.capture();
  let resolveNetwork;
  const network = new Promise(resolve => { resolveNetwork = resolve; });
  let visibleConfirmation = '';
  const request = (async () => {
    const success = await network;
    if (guard.isCurrent(original) && success) visibleConfirmation = 'agency-a';
  })();
  guard.update('agency-b', 'https://agency-b.example/privacy');
  resolveNetwork(true);
  await request;
  assert.equal(visibleConfirmation, '');
});

test('App clears all contact PII/consent and checks generation on success, failure, and finally', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const scopeEffect = app.match(/React\.useLayoutEffect\(\(\) => \{\s*contactRequestScope\.update\(tenantSlug, privacyPolicyUrl\);([\s\S]*?)\}, \[tenantSlug, privacyPolicyUrl, contactRequestScope\]\);/);
  assert.ok(scopeEffect, 'contact reset must depend on BOTH the tenant and the actual privacy policy');
  for (const setter of [
    "setContactName('')","setContactEmail('')","setContactPhone('')",
    "setContactNotes('')","setContactSubmitted(false)","setContactConsent(false)",
    "setContactTrap('')","setContactBusy(false)","setContactError('')",
  ]) assert.ok(scopeEffect[1].includes(setter), 'missing reset: '+setter);
  assert.match(scopeEffect[1], /setContactService\(tenantSlug \? 'Consulta general' : 'Administración Integral de Propiedad'\)/);
  assert.match(app, /const requestGeneration = contactRequestScope\.capture\(\);[\s\S]*?supabase\.rpc\('submit_public_website_lead'/);
  assert.match(app, /if \(!contactRequestScope\.isCurrent\(requestGeneration\)\) return;/);
  assert.match(app, /catch \(error\) \{\s*if \(contactRequestScope\.isCurrent\(requestGeneration\)\)/);
  assert.match(app, /finally \{\s*if \(contactRequestScope\.isCurrent\(requestGeneration\)\)/);
});
