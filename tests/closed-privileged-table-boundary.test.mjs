import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const query = readFileSync(join(root,
  'security/checks/closed_privileged_table_boundary.sql'), 'utf8');
const fixture = readFileSync(join(root,
  'security/tests/closed_privileged_table_fixture.sql'), 'utf8');
const runner = readFileSync(join(root,
  'security/tests/closed_privileged_table_pg17.sh'), 'utf8');

const boundaries = [
  "('jco_private','active_lease_correction_permits',false)",
  "('private','property_intake_sites',false)",
  "('private','website_contact_consents',false)",
  "('public','payment_events',true)",
];

function assertReadOnlyContract(source) {
  const sql = source.split(/\r?\n/).filter(line =>
    !line.trimStart().startsWith('--')).join('\n').trim();
  assert.match(sql, /^WITH\s+expected\s*\(/i);
  assert.ok(sql.endsWith(';'));
  assert.equal((sql.match(/;(?=\s|$)/g) ?? []).length, 1,
    'Catalog preflight must contain one SELECT only');
  assert.doesNotMatch(sql, /\b(?:FROM|JOIN)\s+(?:public|private|auth|storage|supabase_migrations|jco_private)\./i,
    'Tenant data access is forbidden');
  assert.doesNotMatch(sql, /^\s*(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|DO|CALL|GRANT|REVOKE|COPY|EXECUTE|SET)\b/im);
  assert.doesNotMatch(sql, /\b(?:pg_read_file|pg_ls_dir|dblink|postgres_fdw)\s*\(/i);
  for (const name of boundaries)
    assert.ok(sql.includes(name), 'Protected table/ACL contract missing: ' + name);
  for (const pattern of [
    /c\.relrowsecurity/,
    /pg_get_userbyid\(c\.relowner\)/,
    /FROM pg_policy p WHERE p\.polrelid=c\.oid/,
    /has_table_privilege\('anon',c\.oid,/,
    /has_table_privilege\('authenticated',c\.oid,/,
    /has_table_privilege\('service_role',c\.oid,'SELECT'\)/,
    /SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN/,
    /owner_name='postgres' AND policies=0/,
    /anon_any_access IS FALSE AND authenticated_any_access IS FALSE/,
    /service_can_read IS NOT DISTINCT FROM service_read/,
    /relkind='r' AND relrowsecurity/,
    /THEN 'DENY_BOUNDARY_OK' ELSE 'DRIFT'/,
  ]) assert.match(sql, pattern);
  return sql;
}

test('closed payment/private tables use a read-only, four-table deny-by-default contract', () => {
  assertReadOnlyContract(query);
  assert.equal(boundaries.length, 4);
  for (const reference of boundaries) assert.ok(fixture.includes(reference.split("','")[1]?.split("'")[0] ?? ''));
});

test('malicious changes to a preflight contract or extra SQL are rejected', () => {
  const attempts = [
    query.replace(boundaries[3], "('public','payment_events',false)"),
    query.replace('owner_name=\'postgres\' AND policies=0', 'owner_name=\'postgres\''),
    query.replace('anon_any_access IS FALSE', 'anon_any_access IS TRUE'),
    query.replace('authenticated_any_access IS FALSE', 'authenticated_any_access IS TRUE'),
    query.replace('AND relrowsecurity', 'AND NOT relrowsecurity'),
    query.replace('service_can_read IS NOT DISTINCT FROM service_read', 'TRUE'),
    query.replace('THEN \'DENY_BOUNDARY_OK\' ELSE \'DRIFT\'', 'THEN \'DENY_BOUNDARY_OK\' ELSE \'DENY_BOUNDARY_OK\''),
    query + '\nSELECT * FROM public.payment_events;',
    query + '\nREVOKE ALL ON public.payment_events FROM anon;',
  ];
  for (const changed of attempts) {
    assert.notEqual(changed, query, 'Negative mutation must alter query');
    assert.throws(() => assertReadOnlyContract(changed));
  }
});

test('isolated PG17 test fails outside CI and exercises six real privilege/RLS mutations', () => {
  assert.match(runner,/CI:-/);
  assert.match(runner,/Refusing to run outside GitHub CI/);
  assert.match(runner,/psql -X -v ON_ERROR_STOP=1 -h localhost -U postgres/);
  assert.match(runner,/DROP DATABASE IF EXISTS/);
  assert.match(runner,/DROP ROLE IF EXISTS/);
  for (const snippet of [
    'GRANT SELECT ON public.payment_events TO anon',
    'GRANT MAINTAIN ON public.payment_events TO authenticated',
    'DISABLE ROW LEVEL SECURITY',
    'CREATE POLICY unsafe_read ON public.payment_events',
    'GRANT DELETE ON private.website_contact_consents TO anon',
    'REVOKE SELECT ON public.payment_events FROM service_role',
  ]) assert.ok(runner.includes(snippet));
});
