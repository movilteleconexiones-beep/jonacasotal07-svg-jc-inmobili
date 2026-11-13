import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../security/ops/g07_freeze_public_consignment_until_approved.sql',import.meta.url),'utf8');
const modal=readFileSync(new URL('../src/components/SubmitPropertyModal.tsx',import.meta.url),'utf8');
const crm=readFileSync(new URL('../security/ops/g07_freeze_unapproved_public_crm_acl.sql',import.meta.url),'utf8');

test('public consignment closure revokes both anonymous and logged-in intake entry points',()=>{
  assert.match(sql,/REVOKE EXECUTE ON FUNCTION public\.get_public_property_intake_site\(text\)\s+FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/REVOKE EXECUTE ON FUNCTION public\.submit_property_consignment\(text,uuid,jsonb\)\s+FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/has_function_privilege\('anon','public\.get_public_property_intake_site\(text\)','EXECUTE'\)/);
  assert.match(sql,/has_function_privilege\('authenticated','public\.submit_property_consignment\(text,uuid,jsonb\)','EXECUTE'\)/);
  assert.match(sql,/private\.consignment_policy_approvals/);
  assert.match(sql,/v_has_approvals THEN/);
  assert.match(sql,/current_user <> 'postgres'/);
});
test('freeze preserves public catalog and backend service while not mutating tenant records',()=>{
  assert.match(sql,/NOT has_function_privilege\('anon','public\.tenant_public_catalog\(text\)','EXECUTE'\)/);
  assert.match(sql,/NOT has_function_privilege\('service_role','public\.submit_property_consignment\(text,uuid,jsonb\)','EXECUTE'\)/);
  assert.doesNotMatch(sql,/UPDATE\s+(?:public|private)\.|DELETE\s+FROM\s+(?:public|private)\.|TRUNCATE\s+(?:public|private)\./i);
  assert.match(sql,/COMMIT;\s*$/);
});
test('client refuses to collect contact information when intake is unavailable',()=>{
  assert.match(modal,/\) : siteLoading \|\| !site \? \(/);
  assert.match(modal,/No solicitaremos tu nombre, teléfono ni fotografías/);
  assert.match(crm,/REVOKE EXECUTE ON FUNCTION public\.submit_public_website_lead_once/);
});
