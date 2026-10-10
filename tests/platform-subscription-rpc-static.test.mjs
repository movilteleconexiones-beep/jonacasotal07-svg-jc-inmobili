import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261009_platform_subscription_guardrails_review.sql', import.meta.url), 'utf8');

test('manual RPC is platform-admin-only and rejects missing data', () => {
  assert.match(sql, /auth\.uid\(\) is null or not public\.is_platform_admin\(\)/i);
  assert.match(sql, /Missing required subscription data/i);
});
test('draft RPC does not grant trial, paid or lifetime access', () => {
  assert.match(sql, /target_status not in \('SUSPENDED', 'CANCELLED'\)/i);
  assert.match(sql, /Creating an entitlement requires a separate audited grant workflow/i);
});
test('no implicit renewal, status transition or administrative reactivation', () => {
  assert.match(sql, /Changing subscription status requires a separate audited workflow/i);
  assert.match(sql, /Changing an existing plan or billing mode requires a separate audited workflow/i);
  assert.doesNotMatch(sql, /update\s+public\.organizations\s+set/i);
  assert.match(sql, /period_end := null/i);
});
test('serializes changes, validates active plans and contract compatibility', () => {
  assert.match(sql, /where o\.id = target_org for update/i);
  assert.match(sql, /where p\.code = target_plan_code and p\.active = true/i);
  assert.match(sql, /where s\.organization_id = target_org for update/i);
  assert.match(sql, /target_billing_mode in \('DEDICATED', 'CUSTOM'\)/i);
});
