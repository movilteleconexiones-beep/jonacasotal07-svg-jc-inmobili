import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = path =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const scoped = source('security/candidates/g08_scoped_16_relationships_REVIEW_ONLY.sql');
const ownership = source('security/candidates/g08_ownership_link_tenant_guard_REVIEW_ONLY.sql');
const positive = source('security/tests/g08_atomic_dual_candidate_pg17.sql');
const bad = source('security/tests/g08_atomic_failure_fixture_pg17.sql');
const postflight = source('security/tests/g08_atomic_failure_postflight_pg17.sql');
const ci = source('.github/workflows/ci.yml');

test('G08: candidate scripts are single-transaction composable without implicit commits', () => {
  for (const [name, sql] of [['scoped', scoped], ['ownership', ownership]]) {
    const uncommented = sql.replace(/--[^\n]*/g, '');
    assert.doesNotMatch(uncommented, /\b(COMMIT|ROLLBACK|BEGIN\s*;)\s*;/i, name);
    assert.match(uncommented, /SET LOCAL lock_timeout\s*=\s*'3s'/);
    assert.match(uncommented, /DO \$preflight\$/);
    assert.match(uncommented, /DO \$postflight\$/);
  }
});

test('G08: ownership DML lock occurs before the consistency preflight', () => {
  const uncommented = ownership.replace(/--[^\n]*/g, '');
  const lock = uncommented.indexOf('LOCK TABLE public.property_ownerships, public.properties, public.property_owners');
  const check = uncommented.indexOf('DO $preflight$');
  const trigger = uncommented.indexOf('CREATE TRIGGER enforce_property_ownership_same_tenant');
  assert.ok(lock > 0 && lock < check && check < trigger,
    'The preflight/trigger gap must not admit concurrent tenant reassignment or ownership inserts');
  assert.match(uncommented, /IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(uncommented, /SELECT 1 FROM public\.property_ownerships/);
});

test('G08: positive fixture applies exact candidates together and always rolls back', () => {
  assert.match(positive, /^-- G08 #91 isolated PostgreSQL 17 fixture/);
  assert.match(positive, /\\ir \.\.\/candidates\/g08_scoped_16_relationships_REVIEW_ONLY\.sql/);
  assert.match(positive, /\\ir \.\.\/candidates\/g08_ownership_link_tenant_guard_REVIEW_ONLY\.sql/);
  assert.match(positive, /G08 ATOMIC DRY-RUN PASS/);
  assert.match(positive, /G08 ATOMIC ROLLBACK PASS/);
  assert.match(positive, /\nROLLBACK;/);
  assert.doesNotMatch(positive, /\bCOMMIT;/);
});

test('G08: negative fixture forces ownership failure AFTER 16 FK candidate and verifies no partial DDL', () => {
  assert.match(bad, /INSERT INTO public\.property_ownerships/);
  assert.match(bad, /\bCOMMIT;/);
  assert.match(postflight, /BEGIN READ ONLY/);
  assert.match(postflight, /scoped_fk<>0/);
  assert.match(postflight, /unique_fk<>0/);
  assert.match(postflight, /owner_guards<>0/);
  assert.match(postflight, /crossed<>1/);
  assert.match(postflight, /ROLLBACK;\s*$/);
  assert.match(ci, /--single-transaction/);
  assert.match(ci, /Existing ownership relationship crosses tenants/);
  assert.match(ci, /G08 atomic 16-FK \+ ownership release and failure rollback/);
  assert.match(ci, /DROP DATABASE jco_g08_atomic_negative/);
  assert.match(ci, /DROP DATABASE jco_g08_atomic_positive/);
  assert.match(ci, /DROP ROLE IF EXISTS anon, authenticated/);
});
