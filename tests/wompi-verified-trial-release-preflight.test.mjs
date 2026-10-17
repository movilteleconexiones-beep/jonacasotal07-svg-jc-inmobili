import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../security/preflight/wompi_verified_trial_release_readonly.sql',import.meta.url),'utf8');
const sql=source.replace(/--[^\n]*/g,'').trim();

test('reconciliation release preflight cannot mutate production',()=>{
  assert.match(sql,/^BEGIN TRANSACTION READ ONLY\s*;/i);
  assert.match(sql,/ROLLBACK;\s*$/i);
  assert.doesNotMatch(sql,/\b(UPDATE|INSERT|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE|COMMIT|COPY|DO|EXECUTE|PERFORM|CALL)\b/i);
  assert.doesNotMatch(sql,/pg_read_file|dblink|http_post|net\.http_/i);
});
test('read only checks payment signature, origin, original trial and production lock',()=>{
  for(const token of [
    'payment_events','signature_valid','provider_transaction_id',
    'review_reason','contract_review','subscription_status',
    "subscription_status='TRIAL'",'sandbox_enabled','production_enabled',
    'real_approved_orders','preflight_all_green','approved_trial_conversion_safe',
  ]) assert.ok(sql.includes(token), `Missing safeguard: ${token}`);
});
