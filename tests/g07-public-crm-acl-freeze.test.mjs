import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

const ddl=readFileSync(new URL(
  '../security/ops/g07_freeze_unapproved_public_crm_acl.sql',import.meta.url),'utf8');
const sql=ddl.replace(/^\s*--.*$/gm,'');

test('G07 public CRM freeze is strictly ACL-only, transactional and fail-closed',()=>{
 assert.match(sql,/^BEGIN;/m);
 assert.match(sql,/^COMMIT;/m);
 assert.equal((sql.match(/\bREVOKE EXECUTE\b/g)??[]).length,1);
 assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|CALL)\b/i);
 assert.doesNotMatch(sql,/\b(?:http_post|net\.http_post|pg_net|COPY)\b/i);
 assert.match(sql,/current_user <> 'postgres'/);
 assert.match(sql,/to_regclass\('private\.consignment_policy_approvals'\) IS NOT NULL/);
});

test('G07 denies anonymous AND signed-in lead submission without disturbing the public catalog',()=>{
 const rpc='public.submit_public_website_lead_once(text,text,text,text,text,text,boolean,text,uuid)';
 assert.ok(sql.includes(rpc));
 assert.match(sql,/REVOKE EXECUTE ON FUNCTION public\.submit_public_website_lead_once\(text,text,text,text,text,text,boolean,text,uuid\)\s+FROM anon,authenticated/);
 assert.match(sql,/has_function_privilege\('anon','public\.submit_public_website_lead_once/);
 assert.match(sql,/has_function_privilege\('authenticated','public\.submit_public_website_lead_once/);
 assert.match(sql,/NOT has_function_privilege\('anon','public\.tenant_public_catalog\(text\)','EXECUTE'\)/);
 assert.doesNotMatch(sql,/REVOKE.*tenant_public_catalog/);
});

test('G07 never confuses a cosmetic HTTPS link with legally approved documentation',()=>{
 assert.match(ddl,/Confirm signed policies and approved hash\/version/);
 assert.match(sql,/consignment_policy_approvals/);
 assert.doesNotMatch(sql,/approved\s*=\s*true/);
});
