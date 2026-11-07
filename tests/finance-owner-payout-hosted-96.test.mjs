import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const source=readFileSync(
 new URL('../security/tests/finance_test_tenant_rollback_payout_e2e_96.sql', import.meta.url),'utf8');
test('#96 payout E2E only targets authorized test org and cannot persist money records',()=>{
 assert.match(source,/^BEGIN;/m);
 assert.match(source,/SET LOCAL lock_timeout/);
 assert.match(source,/ba\.is_test/);
 assert.match(source,/o\.slug='sistema-inmobiliario-jco'/);
 assert.match(source,/SET LOCAL ROLE authenticated/);
 assert.match(source,/RESET ROLE;\s*ROLLBACK;/);
 assert.match(source,/QA-ONLY-PAYOUT-001/);
 assert.match(source,/QA-ONLY-PAYOUT-002/);
 assert.doesNotMatch(source,/\bCOMMIT\s*;/i);
 assert.doesNotMatch(source,/\bservice_role\b/i);
});
test('#96 owner ledger validates full chain, negative cases, and audit review',()=>{
 for(const snippet of [
  'create_tenant_rent_period','record_tenant_rent_receipt',
  'reconcile_owner_draft_statement_audited',
  'admin_issue_owner_statement','admin_record_owner_payout',
  'request_owner_payout_review','admin_decide_owner_payout_review'
 ])assert.ok(source.includes(snippet),snippet);
 assert.match(source,/denied:=false;/);
 assert.match(source,/SQLSTATE '23514'/);
 assert.match(source,/SQLSTATE '23505'/);
 assert.match(source,/<>net/);
 assert.match(source,/No bank transfers happen in this test/i);
});
test('#96 prevents audit exaggeration: reference path is synthetic, not a verified Storage object',()=>{
 assert.match(source,/A proof reference is NOT a real PDF/i);
 assert.match(source,/qa-only-placeholder\.pdf/);
});
