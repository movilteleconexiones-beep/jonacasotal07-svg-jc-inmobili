import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const sql=readFileSync(
  new URL('../security/reviews/g12_wompi_live_readiness_readonly.sql',import.meta.url),
  'utf8');
const statements=sql.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n');

test('G12 LIVE preflight never initiates a payment, modifies billing or exposes secrets',()=>{
  assert.match(statements,/^BEGIN READ ONLY;/m);
  assert.match(statements,/^ROLLBACK;/m);
  assert.equal((statements.match(/\bBEGIN READ ONLY;/g)??[]).length,1);
  assert.equal((statements.match(/\bROLLBACK;/g)??[]).length,1);
  assert.doesNotMatch(statements,/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|CALL|DO)\b/i);
  assert.doesNotMatch(statements,/\bCOMMIT\s*;/i);
  assert.doesNotMatch(statements,/\bpg_net\b|http_post|net\.http_post/i);
});

test('G12 checks authorized payments, paid plans, terms, and preserves SuperAdmin lifetime',()=>{
  for(const needle of ['billing_activation_settings','payment_orders','payment_events',
    'process_verified_payment_event','has_function_privilege',
    "has_function_privilege('anon'", "has_function_privilege('service_role'",
    'license_terms_versions','organization_billing_access','subscriptions',
    "'LIFETIME'","'BASIC'","'PRO'","production_enabled"]) {
    assert.ok(sql.includes(needle),'Missing go-live check '+needle);
  }
  assert.match(sql,/NOT EXISTS\(SELECT 1 FROM public\.subscriptions/);
  assert.match(sql,/NOT b\.is_test|b\.is_test=false/);
  assert.match(sql,/fulfillment_status='APPLIED'/);
});

test('G12 must mark vendor/legal facts as NOT_VERIFIED until independently proven',()=>{
  for(const name of [
    'live_merchant_credentials_same_account',
    'live_webhook_dashboard_registration',
    'approved_public_legal_policies',
  ]) {
    // A review gate may wrap across lines: bind NULL directly to its named
    // row instead of accidentally treating any other NULL in the query as proof.
    const pattern = new RegExp("'" + name + "'\\s*,\\s*NULL::boolean\\b");
    assert.match(statements,pattern,'Unsafe automatic approval of '+name);
  }
  assert.match(statements,/WHEN passed IS TRUE THEN 'PASS'/);
  assert.match(statements,/WHEN passed IS FALSE THEN 'FAIL'/);
  assert.match(statements,/ELSE 'NOT_VERIFIED'/);
});
