import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const ddl=readFileSync(new URL(
 '../security/candidates/g07_verified_public_crm_consent_receipt_REVIEW_ONLY.sql',import.meta.url),'utf8');
const qa=readFileSync(new URL(
 '../security/tests/g07_crm_policy_receipt_clone_rehearsal.sql',import.meta.url),'utf8');

test('G07 candidate requires existing verified approval registry, preserves immutable receipts and RLS',()=>{
 assert.match(ddl,/BEGIN;/);
 assert.match(ddl,/^COMMIT;/m);
 assert.match(ddl,/current_user <> 'postgres'/);
 assert.match(ddl,/to_regclass\('private\.consignment_policy_approvals'\) IS NULL/);
 assert.match(ddl,/tgname='website_lead_consent_immutable' AND tgenabled='O'/);
 assert.match(ddl,/relrowsecurity/);
 assert.match(ddl,/has_table_privilege\('anon','private\.website_lead_consents','INSERT'\)/);
 assert.match(ddl,/has_table_privilege\('authenticated','private\.website_lead_consents','INSERT'\)/);
 assert.doesNotMatch(ddl,/\b(?:DROP|TRUNCATE|DELETE)\b/i);
 assert.doesNotMatch(ddl,/\b(?:UPDATE|INSERT)\s+public\.(?:contacts|leads)\b/i);
});

test('G07 lead receipts require real per-agency approved URL/version/SHA and fail closed after revocation',()=>{
 assert.match(ddl,/CREATE FUNCTION private\.enforce_approved_policy_on_public_lead_receipt\(\)/);
 assert.match(ddl,/RETURNS trigger[\s\S]*SECURITY DEFINER/);
 assert.match(ddl,/BEFORE INSERT ON private\.website_lead_consents/);
 assert.match(ddl,/a\.organization_id=NEW\.organization_id/);
 assert.match(ddl,/a\.policy_url=NEW\.policy_url/);
 assert.match(ddl,/a\.revoked_at IS NULL/);
 assert.match(ddl,/a\.approved_at<=pg_catalog\.now\(\)/);
 assert.match(ddl,/FOR SHARE/);
 assert.match(ddl,/NEW\.policy_version:=v_version/);
 assert.match(ddl,/NEW\.approved_document_sha256:=v_document_sha/);
 assert.match(ddl,/ERRCODE='42501', MESSAGE='approved_public_policy_required'/);
 assert.match(ddl,/REVOKE ALL ON FUNCTION private\.enforce_approved_policy_on_public_lead_receipt\(\)[\s\S]*FROM PUBLIC,anon,authenticated,service_role/);
 assert.doesNotMatch(ddl,/GRANT EXECUTE TO anon|GRANT EXECUTE TO authenticated/i);
});

test('G07 real-world certification never substitutes fictitious approvals for signed legal policies',()=>{
 assert.match(ddl,/REVIEW ONLY/);
 assert.match(ddl,/Do not run on production while the registry migration #370 is pending/);
 assert.match(qa,/qa-finance-96-foreign-20261113/);
 assert.match(qa,/b\.is_test/);
 assert.doesNotMatch(qa,/jco-inmodigital-global/);
 assert.match(qa,/approved_public_policy_required/);
 assert.match(qa,/UPDATE private\.consignment_policy_approvals SET revoked_at=now\(\)/);
 assert.match(qa,/approved_document_sha256/);
 assert.match(qa,/ROLLBACK;/);
 assert.doesNotMatch(qa,/\bCOMMIT\s*;/);
 assert.match(qa,/example\.invalid/);
});
