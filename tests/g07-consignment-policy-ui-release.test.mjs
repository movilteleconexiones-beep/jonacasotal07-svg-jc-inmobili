import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('the public intake site must contain server-approved policy URL and version', () => {
  const lib=read('src/lib/property-consignments.ts');
  assert.match(lib,/policy_url: string/);
  assert.match(lib,/policy_version: string/);
  assert.match(lib,/safePrivacyPolicyDocumentUrl\(data\?\.policy_url\)/);
  assert.match(lib,/!approvedPolicyUrl/);
  assert.match(lib,/typeof data\?\.policy_version !== 'string'/);
  assert.match(lib,/setSite\(\{ \.\.\.data, policy_url: approvedPolicyUrl \}/);
});

test('consignment consent checkbox is not pre-checked and links the tenant-specific version',()=>{
  const modal=read('src/components/SubmitPropertyModal.tsx');
  assert.match(modal,/useState\(false\)/);
  assert.match(modal,/type="checkbox" checked=\{contactConsent\}/);
  assert.match(modal,/href=\{site\.policy_url\}/);
  assert.match(modal,/versión \{site\.policy_version\}/);
  assert.match(modal,/rel="noopener noreferrer"/);
  assert.match(modal,/política de tratamiento de datos/);
  assert.match(modal,/submitPropertyConsignment\(site\.slug, requestId, input\)/);
});

test('disabled or unapproved intake renders a no-PII status instead of a form',()=>{
  const modal=read('src/components/SubmitPropertyModal.tsx');
  assert.match(modal,/\) : siteLoading \|\| !site \? \(/);
  assert.match(modal,/No solicitaremos tu nombre, teléfono ni fotografías/);
});
