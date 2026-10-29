import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const portal = readFileSync(new URL('../src/modules/portal/PortalHub.tsx',import.meta.url),'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261029120000_linked_person_signed_lease_private_pdf.sql',import.meta.url),'utf8');

test('external portal links PDFs only to verified personal ACTIVE or TERMINATED leases', () => {
  assert.match(portal,/\.in\('entity_id',leaseIds\)/);
  assert.match(portal,/\.eq\('organization_id',organizationId\)/);
  assert.match(portal,/\.eq\('entity_type','GENERAL'\)/);
  assert.match(portal,/\.eq\('document_type','CONTRACT'\)/);
  assert.match(portal,/isSignedLeaseDocument\(document,organizationId,lease\.id\)/);
  assert.match(portal,/\.in\('status',\['ACTIVE','TERMINATED'\]\)/);
});

test('private signed URL only comes from storage and expires in 60 seconds', () => {
  assert.match(portal,/supabase\.storage\.from\(SIGNED_LEASE_BUCKET\)/);
  assert.match(portal,/\.createSignedUrl\(document\.storage_path,60\)/);
  assert.match(portal,/window\.open\(data\.signedUrl,'_blank','noopener,noreferrer'\)/);
  assert.doesNotMatch(portal,/getPublicUrl|service_role|upsert/);
});

test('server RLS requires personal link, matching path and active lease', () => {
  assert.match(migration,/FOR SELECT TO authenticated/);
  assert.match(migration,/documents\.entity_id/);
  assert.match(migration,/le\.organization_id=documents\.organization_id/);
  assert.match(migration,/l\.user_id=\(SELECT auth\.uid\(\)\)/);
  assert.match(migration,/l\.contact_id=le\.tenant_id OR l\.owner_id=le\.owner_id/);
  assert.match(migration,/le\.status IN \('ACTIVE','TERMINATED'\)/);
  assert.match(migration,/storage_bucket='organization-documents'/);
  assert.match(migration,/signed\//);
  assert.doesNotMatch(migration,/FOR ALL|FOR INSERT|FOR UPDATE|FOR DELETE|DROP POLICY/i);
});
