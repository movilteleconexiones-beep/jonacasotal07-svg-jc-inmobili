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
  assert.match(source, /if\s*\(created\?\.id\)\s*onCreated\?\.\(created\.id\)/);
  assert.match(source, /await load\(\);\s*if \(currentOrganization\.current === organizationId\)/);
});

test('contact creation remains scoped to the inmobiliaria', () => {
  assert.match(source, /organization_id: organizationId/);
  assert.match(source, /\.eq\('organization_id', organizationId\)/);
  assert.doesNotMatch(source, /\.from\('contacts'\)\.upsert\(/);
});

test('live duplicate lookup is scoped and fail closed before insert', () => {
  const duplicateLookup = source.indexOf(".ilike('email', literalEmailPattern)");
  const insert = source.indexOf(".from('contacts').insert(payload)");
  assert.ok(duplicateLookup > 0 && insert > duplicateLookup, 'read duplicate before inserting');
  assert.match(source, /literalEmailPattern = email\.replace\(/);
  assert.match(source, /\.eq\('organization_id', organizationId\)\s*\.ilike\('email', literalEmailPattern\)/);
  assert.match(source, /if \(duplicateError\)/);
  assert.match(source, /if \(duplicates\?\.length\)/);
  assert.match(source, /if \(currentOrganization\.current !== organizationId\) return/);
});

test('tenant switch prevents a stale contact from advancing another organization wizard', () => {
  assert.match(source, /currentOrganization\.current = organizationId/);
  assert.match(source, /setShowCreate\(false\);\s*void load\(\)/);
  const dbInsert = source.indexOf(".from('contacts').insert(payload)");
  const staleGuard = source.indexOf('if (currentOrganization.current !== organizationId) return;', dbInsert);
  const callback = source.indexOf('if (created?.id) onCreated?.(created.id);', dbInsert);
  assert.ok(staleGuard > dbInsert && callback > staleGuard);
});


function functionBody(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start !== -1 && end > start, `Function boundary: ${startMarker}`);
  return source.slice(start, end);
}

function assertTenantScopedAsyncMutation(body, rpc, label) {
  const confirmation = body.indexOf('window.confirm(');
  const preWriteGuard = body.indexOf('if(currentOrganization.current!==organizationId)return;', confirmation);
  const rpcCall = body.indexOf(`await supabase.rpc('${rpc}'`);
  const responseGuard = body.indexOf('if(currentOrganization.current!==organizationId)return;', rpcCall);
  const clearEditor = body.indexOf('setEditContact(null)', rpcCall);
  const refresh = body.indexOf('await load()', rpcCall);
  const successGuard = body.indexOf('if(currentOrganization.current===organizationId)', refresh);
  const successNotice = body.indexOf("setMessage('Ficha ", refresh);
  const catchBlock = body.indexOf('}catch{', refresh);
  const catchGuard = body.indexOf('if(currentOrganization.current===organizationId)', catchBlock);
  const catchNotice = body.indexOf("setMessage('No se confirmó", catchBlock);

  assert.ok(confirmation >= 0 && preWriteGuard > confirmation && preWriteGuard < rpcCall,
    `${label}: tenant must still match before calling the privileged RPC`);
  assert.ok(responseGuard > rpcCall && responseGuard < clearEditor,
    `${label}: stale RPC result must not clear the current tenant editor`);
  assert.ok(refresh > clearEditor && successGuard > refresh && successNotice > successGuard,
    `${label}: success notice must be scoped even if tenant switches during refresh`);
  assert.ok(catchGuard > catchBlock && catchNotice > catchGuard,
    `${label}: network errors from the former tenant must not leak into the new tenant`);
}

test('audited contact corrections cannot update the new agency UI after a tenant switch', () => {
  const body = functionBody('async function correctContact(', 'async function deleteUnlinkedContact(');
  assertTenantScopedAsyncMutation(body, 'admin_correct_client_contact', 'correction');
  assert.match(body, /target_org:organizationId,target_contact:editContact\.id/);
});

test('contact deletion responses cannot clear or message a different agency', () => {
  const body = functionBody('async function deleteUnlinkedContact(', '\\n  return (');
  assertTenantScopedAsyncMutation(body, 'admin_delete_unlinked_contact', 'deletion');
  assert.match(body, /target_org:organizationId,target_contact:contact\.id/);
});
