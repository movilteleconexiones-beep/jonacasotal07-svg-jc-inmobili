import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql = read('security/candidates/20261107_personal_lifetime_admin_ONLY.NOT_APPLIED.sql');
const ui = read('src/modules/platform/BillingAdminControls.tsx');
const flags=read('src/core/billing-release-flags.ts');
test('lifetime is grantable only by the designated active platform SuperAdmin',()=>{
 assert.match(sql,/auth\.uid\(\) IS DISTINCT FROM 'f738897b-46df-4c38-9887-5b20c0ff8946'/);
 assert.match(sql,/pa\.user_id=auth\.uid\(\) AND pa\.active/);
 assert.match(sql,/GRANT_LIFETIME/);
 assert.match(sql,/Current terms must be accepted by an active organization owner/);
 assert.match(sql,/jco_private\.plan_capacity_fits\(target_org,target_plan\)/);
 assert.match(sql,/payment_orders/);
 assert.match(sql,/Perpetual license already active/);
 assert.match(sql,/audit_log/);
});
test('lifetime never enables checkout, customer trial or Wompi production',()=>{
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.billing_start_eight_day_trial/);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.process_verified_payment_event/);
 assert.doesNotMatch(sql,/UPDATE public\.billing_activation_settings/);
 assert.match(sql,/GRANT_LIFETIME/);
 assert.match(sql,/max_users=25,max_properties=2000/);
});
test('central admin button uses authenticated RPC, reason and double confirmation',()=>{
 assert.match(ui,/manualLifetimeAdminEnabled && <option value="GRANT_LIFETIME"/);
 assert.match(ui,/window\.confirm/);
 assert.match(ui,/supabase\.rpc\('billing_admin_action'/);
 assert.match(ui,/reason\.trim\(\)/);
 assert.match(flags,/export const manualLifetimeAdminEnabled = true/);
 assert.match(flags,/VITE_BILLING_TRIAL_LIFETIME_ENABLED === 'true'/);
});
