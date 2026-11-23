import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const manifest=JSON.parse(readFileSync(new URL('../security/legal/approved-policy-publication.json',import.meta.url),'utf8'));
const sql=readFileSync(new URL('../security/candidates/g07_register_own_inmodigital_v1_0_REVIEW_ONLY.sql',import.meta.url),'utf8');
const owner=manifest.policies['jco-inmodigital-global'];

test('G07 personal exact PDF v1.0 approved and separate private acta hash',()=>{
 assert.equal(owner.policy_version,'1.0');
 assert.equal(owner.policy_url,'https://www.inmojco.com/politicas/jco-inmodigital-global.pdf');
 for (const value of [owner.policy_url,owner.pdf_sha256,owner.signed_acta_sha256,
   owner.policy_version,owner.approval_reference,owner.approved_at]) {
   assert.ok(sql.includes(value),'Approved manifest value must be present verbatim');
 }
 assert.notEqual(owner.pdf_sha256,owner.signed_acta_sha256);
});

test('G07 personal registry is fail closed for external tenant and never activates public intake or payments',()=>{
 assert.match(sql,/REVIEW ONLY/);
 assert.match(sql,/BEGIN;/);
 assert.match(sql,/COMMIT;/);
 assert.match(sql,/to_regprocedure\('private\.enforce_approved_policy_on_public_lead_receipt\(\)'\)/);
 assert.match(sql,/m\.organization_id=v_external/);
 assert.match(sql,/a\.organization_id=v_external/);
 assert.match(sql,/s\.enabled/);
 assert.doesNotMatch(sql,/\bGRANT\s+EXECUTE\b/i);
 assert.doesNotMatch(sql,/\bUPDATE\s+private\.property_intake_sites\b/i);
 assert.doesNotMatch(sql,/\bproduction_enabled\s*=\s*true\b/i);
 assert.match(sql,/ON CONFLICT \(organization_id\) DO NOTHING/);
 assert.match(sql,/revoked_at IS NULL/);
 assert.doesNotMatch(sql,/INSERT INTO private\.consignment_policy_approvals[\s\S]*?VALUES\(v_external/i);
});
