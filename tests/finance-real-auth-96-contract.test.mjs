// CI verifies presence and fail-closed boundaries only: NOT a live Auth certification.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const source = readFileSync(new URL('./finance-real-auth-96.test.mjs', import.meta.url),'utf8');

test('#96 real-session probe is disabled in ordinary CI and pinned to the restoration clone', () => {
  assert.match(source,/process\.env\.JCO_QA96_RUN_REAL_AUTH === '1'/);
  assert.match(source,/CLONE_REF = 'zjgstfgiirgjssnihaam'/);
  assert.match(source,/endpoint\.origin, 'https:\/\/' \+ CLONE_REF \+ '\.supabase\.co'/);
  assert.match(source,/persistSession:false/g);
  assert.match(source,/client\.auth\.signInWithPassword/);
  assert.match(source,/client\.auth\.getUser/);
  assert.match(source,/userIds\.size, 5/);
  assert.match(source,/signatures\.size, 5/);
  assert.match(source,/jco-rent-receipts-private/g);
  assert.match(source,/other tenant/);
  assert.doesNotMatch(source,/createUser\(|auth\.admin\.|\.insert\(|\.update\(|\.delete\(|\.upload\(|\.remove\(/);
  assert.doesNotMatch(source,/\b(INSERT INTO|UPDATE auth\.|COMMIT|CREATE FUNCTION)\b/i);
});

test('#96 acceptance probe covers the exact privileged roles, five RPC decisions, and private PDFs', () => {
  for(const role of ['ORGANIZATION_OWNER','ADMIN','MANAGER','AGENT','CLIENT']){
    assert.ok(source.includes("name:'"+role+"'"),role+' missing');
  }
  for(const rpc of ['admin_issue_owner_statement','admin_record_owner_payout',
     'admin_decide_owner_payout_review','record_tenant_rent_receipt']){
    assert.ok(source.includes(rpc),rpc+' missing');
  }
  assert.match(source,/\['other tenant', 'admin_issue_owner_statement'/);
  assert.match(source,/assert\.equal\(start,'%PDF-'/);
  assert.match(source,/anonymous cannot download the private receipt/);
  assert.match(source,/foreignPdf/);
});
