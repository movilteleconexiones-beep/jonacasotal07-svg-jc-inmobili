import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * G07 fail-closed presentation regression.
 * Backend private.property_intake_sites and the SECURITY DEFINER RPC remain
 * authoritative. These tests ensure the UI never asks for PII if intake is OFF.
 */
const modal = readFileSync(new URL('../src/components/SubmitPropertyModal.tsx', import.meta.url),'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url),'utf8');

test('public consignment form is rendered only when the current tenant intake is available', () => {
  const branchStart = modal.indexOf(') : siteLoading || !site ? (');
  const formStart = modal.indexOf('<form onSubmit={handleSubmit}',branchStart);
  assert.ok(branchStart > 0 && formStart > branchStart,'The form must be gated by active site availability');
  const unavailable=modal.slice(branchStart,formStart);
  assert.match(unavailable,/role="status"/);
  assert.match(unavailable,/Recepción de consignaciones temporalmente no disponible/);
  assert.match(unavailable,/No solicitaremos tu nombre, teléfono ni fotografías/);
  assert.doesNotMatch(unavailable,/id="owner-name"|id="owner-phone"|id="consignment-photos"|type="submit"/);
  const form=modal.slice(formStart);
  assert.match(form,/id="owner-name"/);
  assert.match(form,/id="owner-phone"/);
  assert.match(form,/id="consignment-photos"/);
  assert.match(form,/Enviar consignación/);
});

test('RPC submit handler requires an available site and the button never bypasses server access', () => {
  assert.match(modal,/if \(!site \|\| siteLoading\)/);
  assert.match(modal,/const reference = await submitPropertyConsignment\(site\.slug, requestId, input\)/);
});

test('changing agencies remounts the consignment modal to clear stale PII and form state', () => {
  assert.match(app,/<SubmitPropertyModal\s+key=\{tenantSlug \|\| 'platform'\}/);
  assert.match(app,/publicSiteSlug=\{tenantSlug\}/);
});
