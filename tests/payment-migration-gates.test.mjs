import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../supabase/migrations/0028_verified_payment_subscription_activation.sql', import.meta.url), 'utf8');

test('payment activation requires service role and restricts grants', () => {
  assert.match(sql, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.process_verified_payment_event[\s\S]*FROM PUBLIC,anon,authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.process_verified_payment_event[\s\S]*TO service_role/i);
});

test('activation requires approved event, matching COP plan and exact amount', () => {
  assert.match(sql, /IF p_status='APPROVED' THEN/);
  assert.match(sql, /v_plan\.currency <> 'COP'/);
  assert.match(sql, /v_plan\.price\*100\) <> v_order\.amount_in_cents/);
  assert.match(sql, /v_order\.billing_mode='LIFETIME'/);
});

test('order and subscription writes are transactionally coupled', () => {
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /INSERT INTO public\.payment_events/);
  assert.match(sql, /UPDATE public\.payment_orders/);
  assert.match(sql, /INSERT INTO public\.subscriptions/);
  assert.match(sql, /COMMIT;/);
});

test('duplicates are checked before any payment or subscription updates', () => {
  const duplicate = sql.indexOf("THEN RETURN 'duplicate'");
  const write = sql.indexOf('INSERT INTO public.payment_events');
  assert.ok(duplicate > 0 && write > duplicate);
});
