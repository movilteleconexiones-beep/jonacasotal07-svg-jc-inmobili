import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const sql = readFileSync(
  new URL('../security/tests/finance_roles_hosted_clone_rollback_96.sql', import.meta.url),
  'utf8',
);
const permissions = new Map([
  ['ORGANIZATION_OWNER', true],
  ['ADMIN', true],
  ['MANAGER', false],
  ['AGENT', false],
  ['CLIENT', false],
]);

test('#96 role matrix runs only against the restored test tenant and cannot commit', () => {
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^ROLLBACK;$/m);
  assert.match(sql, /SET LOCAL lock_timeout/);
  assert.match(sql, /SET LOCAL statement_timeout/);
  assert.match(sql, /private\.consignment_policy_receipts/);
  assert.match(sql, /supabase_migrations\.schema_migrations\)<109/);
  assert.match(sql, /ba\.is_test/);
  assert.match(sql, /o\.slug='sistema-inmobiliario-jco'/);
  assert.match(sql, /pa\.user_id IS NULL/);
  assert.match(sql, /SELECT COUNT\(\*\) FROM public\.member_roles/);
  assert.match(sql, /SET LOCAL ROLE authenticated/g);
  assert.match(sql, /RESET ROLE;/g);
  assert.match(sql, /current_setting\('qa\.actor'\)/);
  assert.match(sql, /DELETE FROM public\.member_roles/);
  assert.match(sql, /INSERT INTO public\.member_roles/);
  assert.doesNotMatch(sql, /\bCOMMIT\s*;/i);
  assert.doesNotMatch(sql, /\b(TRUNCATE|DROP|ALTER TABLE|CREATE EXTENSION|COPY|dblink)\b/i);
  assert.doesNotMatch(sql, /\bservice_role\b/i);
  assert.equal((sql.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((sql.match(/^ROLLBACK;$/gm) ?? []).length, 1);
  assert.ok(sql.indexOf('ROLLBACK;') > sql.lastIndexOf('RESET ROLE;'));
});

test('#96 matrix asserts 5 exclusive roles and 25 finance RPC decisions', () => {
  const blocks = [...sql.matchAll(
    /^-- Isolate ([A-Z_]+) within the ongoing transaction\.\n([\s\S]*?)(?=^-- Isolate |^-- The statement above)/gm,
  )];
  assert.equal(blocks.length, 5, 'All five agency roles must be covered');
  assert.deepEqual(blocks.map(x => x[1]), [...permissions.keys()]);
  const operations = [
    /public\.admin_issue_owner_statement\(/,
    /public\.admin_record_owner_payout\(/,
    /public\.admin_decide_owner_payout_review\(/,
    /public\.record_tenant_rent_receipt\(/,
    /public\.admin_issue_owner_statement\('[^']+'::uuid,outsider\)/,
  ];
  for (const [, role, section] of blocks) {
    assert.match(section, /DELETE FROM public\.member_roles/);
    assert.match(section, /INSERT INTO public\.member_roles/);
    for (const op of operations) assert.match(section, op, role);
    const privileged = permissions.get(role);
    const state = privileged ? 'P0002' : '42501';
    const rentState = privileged ? '23514' : '42501';
    for (const prefix of ['issue_state', 'payout_state', 'review_state']) {
      assert.ok(section.includes(prefix + "<>'" + state + "'"), role + ' missing expected ' + prefix);
    }
    assert.ok(section.includes("receipt_state<>'" + rentState + "'"), role + ' rent guard');
    assert.ok(section.includes("cross_state<>'42501'"), role + ' cross tenant denial');
    assert.match(section, /SET LOCAL ROLE authenticated/);
    assert.match(section, /RESET ROLE;/);
  }
});

test('#96 cannot create Auth users or real bank payouts', () => {
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+auth\./i);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.owner_statement_payouts/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+public\.owner_statement_payouts/i);
  assert.match(sql, /current_setting\('qa\.actor'\)::uuid/);
  assert.match(sql, /no persisted QA writes/);
});
