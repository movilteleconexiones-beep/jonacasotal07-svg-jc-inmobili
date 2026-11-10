import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const candidate = read('security/candidates/privacy_policy_document_receipts_guard.sql');
const migration = read('security/applied/20261110062359_privacy_policy_document_receipts_guard.sql');
const rollback = read('security/rollback/20261110062359_privacy_policy_document_receipts_guard.sql');

test('production migration contains identical verified SQL as PG17 candidate',()=>{
  const body = value => value.slice(value.indexOf('ALTER TABLE')).replace(/\s+COMMIT;\s*$/, '').trim();
  assert.equal(body(migration),body(candidate));
  assert.match(candidate,/BEGIN;\s*[\s\S]*COMMIT;\s*$/);
  for(const check of [
    'website_lead_consents_not_platform_page',
    'website_contact_consents_not_platform_page',
  ]){
    assert.match(migration,new RegExp('ADD CONSTRAINT '+check));
    assert.match(rollback,new RegExp('DROP CONSTRAINT IF EXISTS '+check));
  }
  assert.doesNotMatch(migration,/DELETE FROM|TRUNCATE|DROP TABLE|DROP POLICY/i);
});

test('homepage guard has a negative and positive real RPC rollback test',()=>{
  const sql=read('security/tests/privacy_policy_document_receipts_guard_pg17.sql');
  assert.match(sql,/FOREACH current_bad IN ARRAY bad_urls LOOP/);
  assert.match(sql,/EXCEPTION WHEN check_violation THEN blocked:=true/);
  assert.match(sql,/public\.submit_public_website_lead_once/);
  assert.match(sql,/public\.contacts WHERE organization_id=bravo/);
  assert.match(sql,/public\.leads WHERE organization_id=bravo/);
  assert.match(sql,/private\.website_lead_consents WHERE organization_id=bravo/);
  assert.match(sql,/\/politicas\/bravo-agency\.pdf/);
});
