import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root, 'security/checks/commercial_basic_pro_parity.sql'), 'utf8');
const fixture = readFileSync(join(root, 'security/tests/commercial_plan_parity_fixture.sql'), 'utf8');
const runner = readFileSync(join(root, 'security/tests/commercial_plan_parity_pg17.sh'), 'utf8');

function verifyReadOnlyCatalogue(raw) {
  const body = raw.split(/\r?\n/).filter(row =>
    !row.trimStart().startsWith('--')).join('\n').trim();
  assert.match(body,/^WITH\s+expected\s*\(/i);
  assert.ok(body.endsWith(';'));
  assert.equal((body.match(/;(?=\s|$)/g)??[]).length,1);
  assert.doesNotMatch(body,/\b(?:FROM|JOIN)\s+public\.(?!plans\b|plan_features\b)/i,
    'Never read organizations, subscriptions, customer or payment records');
  assert.doesNotMatch(body,/\b(?:FROM|JOIN)\s+(?:auth|private|storage|supabase_migrations)\./i);
  assert.doesNotMatch(body,/^\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|DO|CALL|COPY|GRANT|REVOKE|EXECUTE|SET|MERGE)\b/im);
  for (const anchor of [
    "('BASIC',5,200)", "('PRO',25,2000)",
    "p.currency='COP' AND p.price>0",
    "p.active AND p.billing_cycle='MONTHLY'",
    "SELECT p.code,f.feature_key,f.enabled",
    "EXCEPT SELECT feature_key,enabled FROM features WHERE code='PRO'",
    "EXCEPT SELECT feature_key,enabled FROM features WHERE code='BASIC'",
    "NOT EXISTS(SELECT 1 FROM differences)",
    "count(*)=47 AND bool_and(enabled)",
    "FROM checks ORDER BY check_key"
  ]) assert.ok(body.includes(anchor),'Contract missing: '+anchor);
  // The two feature-count assertions must remain separately present.
  // Merely finding one shared substring could miss a broken Basic or Pro rule.
  assert.match(body, /'basic_47_enabled_features',\\s*\\(SELECT count\\(\\*\\)=47 AND bool_and\\(enabled\\) FROM features WHERE code='BASIC'\\)/);
  assert.match(body, /'professional_47_enabled_features',\\s*\\(SELECT count\\(\\*\\)=47 AND bool_and\\(enabled\\) FROM features WHERE code='PRO'\\)/);
  for (const label of [
    'two_and_only_two_monthly_plans',
    'basic_5_users_and_200_properties',
    'professional_25_users_and_2000_properties',
    'feature_lists_identical',
    'basic_47_enabled_features',
    'professional_47_enabled_features'
  ]) assert.ok(body.includes("'"+label+"'"),'Missing release check '+label);
  return body;
}

test('public paid monthly plans preserve feature equality, same tools, 5/25 user caps',()=>{
  verifyReadOnlyCatalogue(sql);
  assert.match(fixture,/generate_series\(1,47\)/);
  assert.match(fixture,/('BASIC'|'PRO')/);
  assert.match(fixture,/permission:synthetic_/);
});

test('catalogue preflight fails closed against weakened parity rules and extra SQL',()=>{
  for(const bad of [
    sql.replace("('BASIC',5,200)","('BASIC',6,200)"),
    sql.replace('p.currency=\'COP\' AND p.price>0',"p.currency='COP'"),
    sql.replace('f.feature_key,f.enabled','f.feature_key,true AS enabled'),
    sql.replace('count(*)=47 AND bool_and(enabled)','count(*)>=0'),
    sql.replace('NOT EXISTS(SELECT 1 FROM differences)','true'),
    sql+'\nUPDATE public.plans SET price=0;',
    sql+'\nSELECT * FROM public.organization_members;'
  ]) {
    assert.notEqual(bad,sql);
    assert.throws(()=>verifyReadOnlyCatalogue(bad));
  }
});

test('PG17 negative suite is CI-only and restores each mutation',()=>{
  assert.match(runner,/CI:-/);
  assert.match(runner,/Refusing to run outside CI/);
  assert.match(runner,/psql -X -v ON_ERROR_STOP=1 -h localhost -U postgres/);
  assert.match(runner,/DROP DATABASE IF EXISTS/);
  assert.match(runner,/expect_drift two_and_only_two_monthly_plans/);
  assert.match(runner,/expect_drift feature_lists_identical/);
  assert.match(runner,/expect_drift basic_5_users_and_200_properties/);
  assert.match(runner,/expect_drift professional_25_users_and_2000_properties/);
  assert.match(runner,/assert_clean/);
});
