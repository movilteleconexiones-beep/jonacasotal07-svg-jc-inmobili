import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const sql=readFileSync(
  new URL('../security/tests/finance_roles_two_qa_tenants_rollback_96.sql',import.meta.url),'utf8');

test('#96 25 financial checks now use only two known QA test tenants',()=>{
  assert.match(sql,/o\.slug='sistema-inmobiliario-jco'/);
  assert.match(sql,/o\.slug='qa-finance-96-foreign-20261113'/);
  assert.match(sql,/ba\.is_test=true AND ba\.requires_payment=false/);
  assert.doesNotMatch(sql,/jco-inmodigital-global/);
  assert.match(sql,/ba\.is_test/);
  assert.equal((sql.match(/^-- Isolate /gm)??[]).length,5);
  assert.match(sql,/^BEGIN;$/m);
  assert.match(sql,/^ROLLBACK;$/m);
  assert.equal((sql.match(/^BEGIN;$/gm)??[]).length,1);
  assert.equal((sql.match(/^ROLLBACK;$/gm)??[]).length,1);
  assert.doesNotMatch(sql,/\bCOMMIT\s*;/i);
  assert.doesNotMatch(sql,/\bservice_role\b/i);
});

test('#96 all five roles test authorization and foreign-tenant rejection',()=>{
  for(const role of ['ORGANIZATION_OWNER','ADMIN','MANAGER','AGENT','CLIENT']){
    assert.ok(sql.includes('-- Isolate '+role+' within the ongoing transaction.'),
      role+' role missing');
  }
  for(const rpc of ['admin_issue_owner_statement','admin_record_owner_payout',
    'admin_decide_owner_payout_review','record_tenant_rent_receipt']){
    assert.ok(sql.includes('public.'+rpc+'('),rpc+' missing');
  }
  assert.match(sql,/cross_state<>'42501'/);
  assert.match(sql,/no persisted QA writes/);
  assert.match(sql,/auth\.uid\(\) IS DISTINCT FROM current_setting\('qa\.actor'\)::uuid/);
  assert.ok(sql.indexOf('ROLLBACK;')>sql.lastIndexOf('RESET ROLE;'));
});
