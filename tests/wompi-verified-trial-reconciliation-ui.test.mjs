import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../src/modules/platform/BillingAdminControls.tsx',import.meta.url),'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261017090000_verified_trial_to_paid_reconciliation.sql',import.meta.url),'utf8');

test('SuperAdmin can identify ONLY verified approved sandbox orders held for contract review', () => {
  assert.match(admin,/\.from\('payment_orders'\)/);
  for(const [field,value] of [
    ['environment','sandbox'], ['status','APPROVED'],
    ['fulfillment_status','REVIEW_REQUIRED'], ['review_reason','contract_review'],
  ]) assert.ok(admin.includes(`.eq('${field}','${value}')`), `Missing ${field} filter`);
  assert.match(admin,/\.eq\('organization_id',tenant\.organization_id\)/);
  assert.match(admin,/billing_admin_reconcile_verified_trial_payment/);
  assert.match(admin,/reason\.trim\(\)\.length\s*<\s*10/);
  assert.doesNotMatch(admin,/\.from\('subscriptions'\)[\s\S]{0,150}\.update\(/);
});

test('backend verifies SuperAdmin, Sandbox, signature and trial before audited one-time activation',()=>{
  for(const pattern of [
    /public\.is_platform_admin\(\)/, /payment\.environment <> 'sandbox'/,
    /payment\.status <> 'APPROVED'/, /payment\.review_reason <> 'contract_review'/,
    /e\.signature_valid IS TRUE/, /actual_events <> 1/,
    /sub\.status <> 'TRIAL'/, /access_row\.is_test IS DISTINCT FROM true/,
    /gate\.production_enabled IS DISTINCT FROM false/, /paid_end:=greatest\(/,
    /'billing\.trial_paid_order_reconciled'/, /payment\.fulfillment_status='APPLIED'/,
    /REVOKE ALL ON FUNCTION public\.billing_admin_reconcile_verified_trial_payment/,
  ]) assert.match(migration,pattern);
  assert.doesNotMatch(migration,/UPDATE public\.payment_events|DELETE FROM public\.payment_events/);
});
