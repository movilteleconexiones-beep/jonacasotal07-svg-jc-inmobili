import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20261031090000_guard_plan_capacity_for_billing.sql', import.meta.url),
  'utf8',
);

test('counts operational seats, excluding external-only members', () => {
  assert.match(migration, /m\.status='ACTIVE'/);
  assert.match(migration, /NOT jco_private\.is_external_only_member\(m\.id\)/);
  assert.match(migration, /v_used_users<=v_max_users/);
});

test('counts all registered properties, and treats null limits as unlimited', () => {
  assert.match(migration, /FROM public\.properties WHERE organization_id=p_org/);
  assert.match(migration, /v_max_properties IS NULL OR v_used_properties<=v_max_properties/);
  assert.match(migration, /v_max_users IS NULL OR v_used_users<=v_max_users/);
});

test('protects both administrative plan paths', () => {
  assert.match(migration, /public\.billing_admin_action\(uuid,text,text,uuid\)/);
  assert.match(migration, /public\.platform_set_subscription\(uuid,text,text,text\)/);
  assert.match(migration, /PERFORM 1 FROM public\.organizations WHERE id=target_org FOR UPDATE/);
  assert.equal((migration.match(/RAISE EXCEPTION ''Plan capacity exceeded''/g) || []).length, 2);
});

test('uses review instead of rollback in the verified payment path', () => {
  assert.match(migration, /public\.process_verified_payment_event\(text,text,bigint,text,text,text,text,text\)/);
  assert.match(migration, /WHEN NOT jco_private\.plan_capacity_fits\(org\.id,payment\.plan_id\) THEN ''plan_capacity_review''/);
  assert.doesNotMatch(migration, /(?:DELETE FROM public\.payment_orders|TRUNCATE public\.payment_events)/i);
});

test('denies publicly callable helper functions', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION jco_private\.plan_capacity_fits\(uuid,uuid\) FROM PUBLIC,anon,authenticated/);
  assert.match(migration, /SECURITY DEFINER SET search_path = ''/);
});

test('stops if privileged RPC definitions drift', () => {
  assert.equal((migration.match(/RAISE EXCEPTION 'Unexpected % definition'/g) || []).length, 3);
});
