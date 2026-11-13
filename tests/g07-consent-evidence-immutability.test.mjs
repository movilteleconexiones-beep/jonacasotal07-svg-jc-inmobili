import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');

const candidate = read('security/candidates/g07_consignment_private_approval_consent_REVIEW_ONLY.sql');
const integration = read('security/tests/g07_consignment_policy_guard_pg17.sql');

test('G07: receipt cannot disappear when its parent consignment is deleted', () => {
  assert.match(candidate,
    /consignment_id uuid PRIMARY KEY REFERENCES public\.property_consignments\(id\) ON DELETE RESTRICT/);
  assert.match(candidate,
    /REFERENCES public\.property_consignments\(organization_id,request_id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(candidate,
    /REFERENCES public\.property_consignments\([^)]*\) ON DELETE CASCADE/);
  assert.match(candidate,
    /c\.confdeltype='r'/);
  assert.match(integration,
    /Hard-deleting a consignment with consent evidence must be blocked/);
});

test('G07: consent receipt has an immutable update/delete trigger and private ACLs', () => {
  assert.match(candidate, /CREATE FUNCTION private\.deny_consignment_receipt_mutation\(\)/);
  assert.match(candidate, /MESSAGE='consignment_consent_immutable'/);
  assert.match(candidate,
    /BEFORE UPDATE OR DELETE ON private\.consignment_policy_receipts/);
  assert.match(candidate,
    /REVOKE ALL ON TABLE private\.consignment_policy_receipts\s+FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(candidate,
    /REVOKE ALL ON FUNCTION private\.deny_consignment_receipt_mutation\(\)/);
  assert.match(integration, /An approved consent receipt must not be modifiable/);
  assert.match(integration, /An approved consent receipt must not be deleted/);
});

test('G07: the photo resolver blocks expired tenancy access and preserves consent check', () => {
  const sql = candidate.split('CREATE OR REPLACE FUNCTION public.resolve_consignment_photo_submission')[1];
  assert.ok(sql, 'Photo resolver must be defined');
  assert.match(sql, /JOIN private\.consignment_policy_receipts receipt/);
  assert.match(sql, /a\.revoked_at IS NULL/);
  assert.match(sql, /jco_private\.operational_access\(s\.organization_id\)/);
  assert.match(integration,
    /Photo resolver must reject when tenant operational access is suspended/);
});
