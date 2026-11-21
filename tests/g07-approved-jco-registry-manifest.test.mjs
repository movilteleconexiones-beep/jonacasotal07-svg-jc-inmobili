import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest=JSON.parse(readFileSync(new URL('../security/legal/approved-policy-publication.json', import.meta.url),'utf8'));
const sql=readFileSync(new URL('../security/candidates/g07_register_approved_jco_v1_2_REVIEW_ONLY.sql',import.meta.url),'utf8');
const agency=manifest.policies['sistema-inmobiliario-jco'];

test('G07 approved JCO registry matches the exact published manifest',()=>{
  assert.equal(agency.policy_version,'1.2');
  for (const value of [agency.policy_url,agency.pdf_sha256,agency.approval_reference,agency.approved_at]) {
    assert.ok(sql.includes(value), 'approved manifest field must match SQL');
  }
  assert.ok(!manifest.policies['jco-inmodigital-global'], 'other agency must not gain approval');
});
test('G07 candidate is fail-closed and never opens public collection or billing',()=>{
  assert.match(sql,/REVIEW ONLY/);
  assert.match(sql,/BEGIN;/);
  assert.match(sql,/ROLLBACK|DO NOTHING/);
  assert.match(sql,/relrowsecurity/);
  assert.match(sql,/s\.enabled/);
  assert.match(sql,/revoked_at IS NULL/);
  assert.doesNotMatch(sql,/\bGRANT\s+EXECUTE\b/i);
  assert.doesNotMatch(sql,/\bproduction_enabled\s*=\s*true\b/i);
  assert.doesNotMatch(sql,/\bUPDATE\s+private\.property_intake_sites\b/i);
  assert.doesNotMatch(sql,/\bINSERT\s+INTO\s+public\./i);
});
