import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(root,
  'security/checks/rental_0026_baseline_contract_live.sql'),'utf8');

function verifyReadOnlyContract(raw) {
  const source = raw.split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--')).join('\n').trim();
  assert.match(source, /^WITH\s+original_columns\s*\(/i);
  assert.ok(source.endsWith(';'));
  assert.equal((source.match(/;(?=\s|$)/g) ?? []).length,1,
    'Multiple SQL statements are forbidden in production catalog checks');
  assert.doesNotMatch(source, /\b(?:FROM|JOIN)\s+(?:public|private|auth|storage|supabase_migrations)\./i,
    'Never query tenant records');
  assert.doesNotMatch(source, /^\s*(?:ALTER|CREATE|DROP|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|DO|CALL|COPY|GRANT|REVOKE|SET|RESET|VACUUM|REFRESH|EXECUTE)\b/im,
    'Only immutable pg_catalog metadata is permitted');
  assert.doesNotMatch(source, /\b(?:pg_read_file|pg_ls_dir|dblink|postgres_fdw)\s*\(/i);
  for (const pgCatalog of ['pg_class','pg_attribute','pg_index','pg_policy']) {
    assert.match(source,new RegExp('\\b(?:FROM|JOIN)\\s+' + pgCatalog + '\\b','i'),
      'Catalog source missing: ' + pgCatalog);
  }
  assert.match(source, /format_type\(a\.atttypid,a\.atttypmod\)/);
  assert.match(source, /a\.attnotnull=o\.original_not_null/);
  assert.match(source, /original_index_present_valid/);
  assert.match(source, /original_all_authenticated_policy_present/);
  assert.match(source, /AND idx\.indisvalid AND idx\.indisready/);
  assert.match(source, /original_index_definition_intact/);
  assert.match(source, /extra\.polrelid=t\.oid AND extra\.polpermissive/);
  assert.match(source, /extra\.polname<>t\.initial_policy/);
  assert.match(source, /AND NOT unexpected_permissive_policy_present/);
  assert.match(source, /expected_portal_policy_count=verified_portal_policy_count/);
  // A mutation of any allowlisted predicate or the NOT EXISTS rejection path
  // must invalidate this static source contract even before querying Postgres.
  assert.ok(source.includes('AND NOT EXISTS (\n           SELECT 1 FROM approved_portal_policies a'));
  for(const [table,policy,sha] of [["leases","leases_owner_portal_select","8edc2a7a4a9fe194979395b5fda9012a62d778604ee87553abbb7e2f0a5f876d"],["leases","leases_tenant_portal_select","1c83a68d500060fa11e84286173c954e3fdf606ac088d423efd262d3a72f99b6"],["owner_statements","owner_statements_external_issued","6f9fa81441bd18f3e1cff94e1eadcd888cfb6810504f66bc0300058ede6cac84"],["rent_payments","rent_payments_external_personal","3cbbecfd27ecc63fc035c57d390f3a6fd446f01150ad9845d09d892cc925ef12"]])
    assert.ok(source.includes("('"+table+"','"+policy+"','"+sha+"')"),
      'Pinned portal policy predicate missing: '+policy);
  assert.match(source, /pol\.polcmd='r' AND pol\.polwithcheck IS NULL/);
  assert.match(source, /extra\.polcmd='r' AND extra\.polwithcheck IS NULL/);
  assert.match(source, /pol\.polroles=ARRAY\['authenticated'::regrole::oid\]/);
  assert.match(source, /extra\.polroles=ARRAY\['authenticated'::regrole::oid\]/);
  assert.match(source, /encode\(sha256\(convert_to\(pg_get_expr\(pol\.polqual,pol\.polrelid\),'UTF8'\)\),'hex'\)=a\.using_sha256/);
  assert.match(source, /encode\(sha256\(convert_to\(pg_get_expr\(extra\.polqual,extra\.polrelid\),'UTF8'\)\),'hex'\)=a\.using_sha256/);

  assert.match(source, /current_staff_guard_intact/);
  assert.match(source, /pol\.polcmd='\*' AND pol\.polpermissive/);
  assert.match(source, /pol\.polroles=ARRAY\['authenticated'::regrole::oid\]/);
  assert.match(source, /pg_get_expr\(pol\.polqual,pol\.polrelid\)/);
  assert.match(source, /pg_get_expr\(pol\.polwithcheck,pol\.polrelid\)/);
  assert.match(source, /AND original_index_definition_intact AND current_staff_guard_intact/);
  const expectedGuard = '(is_platform_admin() OR jco_private.is_internal_staff(organization_id))';
  assert.equal(source.split(expectedGuard).length - 1, 2,
    'Both USING and WITH CHECK must enforce the exact approved staff guard');
  for (const def of [
    'CREATE INDEX idx_leases_org ON public.leases USING btree (organization_id)',
    'CREATE INDEX idx_rent_payments_lease ON public.rent_payments USING btree (lease_id)',
    'CREATE INDEX idx_owner_statements_owner ON public.owner_statements USING btree (owner_id)',
    'CREATE INDEX idx_maintenance_property ON public.maintenance_requests USING btree (property_id)',
  ]) assert.ok(source.includes(def),'Pinned index definition absent: ' + def);
  return source;
}

test('0026 baseline SELECT is catalog-only with no repair side effects',()=>{
  verifyReadOnlyContract(sql);
  for (const adversary of [
    '\nDROP TABLE public.leases;',
    '\nSELECT * FROM public.leases;',
    '\nUPDATE public.rent_payments SET paid_amount = 0;',
    '\nDELETE FROM supabase_migrations.schema_migrations;',
    '\nSELECT 1;',
  ]) assert.throws(()=>verifyReadOnlyContract(sql + adversary));
});

test('all 47 applied original columns have pinned names, types and nullability',()=>{
  const stripped = verifyReadOnlyContract(sql);
  const body = stripped.split('), original_objects(')[0];
  const rowPattern = /\('((?:leases|rent_payments|owner_statements|maintenance_requests))','([a-z_]+)','([a-z0-9 (),]+)',(true|false)\)/g;
  const matched = [...body.matchAll(rowPattern)];
  assert.equal(matched.length,47,'Original 4-table schema cannot silently lose columns');
  const expected = new Map([
    ['leases',15],['rent_payments',10],
    ['owner_statements',12],['maintenance_requests',10],
  ]);
  const seen = new Set();
  for (const [,table,name,,required] of matched) {
    assert.ok(required==='true'||required==='false');
    const key = `${table}.${name}`;
    assert.ok(!seen.has(key),'Duplicate column '+key);
    seen.add(key);
  }
  for (const [table,amount] of expected)
    assert.equal(matched.filter(m=>m[1]===table).length,amount,
      'Baseline column count drift: '+table);
  for (const spec of [
    "('leases','monthly_rent','numeric(16,2)',true)",
    "('leases','adjustment_percentage','numeric(8,2)',false)",
    "('rent_payments','expected_amount','numeric(16,2)',true)",
    "('owner_statements','net_amount','numeric(16,2)',true)",
    "('maintenance_requests','reported_by','uuid',false)",
  ]) assert.ok(body.includes(spec),'Key original column contract missing '+spec);
});

test('retains the four original index and authenticated RLS policy identities',()=>{
  verifyReadOnlyContract(sql);
  for (const spec of [
    "('leases','idx_leases_org','leases_org_access')",
    "('rent_payments','idx_rent_payments_lease','rent_payments_org_access')",
    "('owner_statements','idx_owner_statements_owner','owner_statements_org_access')",
    "('maintenance_requests','idx_maintenance_property','maintenance_org_access')",
  ]) assert.ok(sql.includes(spec));
  assert.match(sql,/matching_original_columns=original_column_count/);
  assert.match(sql,/'BASELINE_COMPATIBLE'/);
  assert.match(sql,/'DRIFT'/);
});

test('0026 current policy and index guards reject a relaxed predicate or substituted index',()=>{
  const denied = [
    sql.replace('AND pol.polpermissive', 'AND NOT pol.polpermissive'),
    sql.replace('AND pol.polroles=ARRAY', 'AND pol.polroles<>ARRAY'),
    sql.replace('pg_get_expr(pol.polqual,pol.polrelid)', 'TRUE'),
    sql.replace('pg_get_expr(pol.polwithcheck,pol.polrelid)', 'TRUE'),
    sql.replace('AND original_index_definition_intact AND current_staff_guard_intact',
      'AND original_index_definition_intact'),
    sql.replace('USING btree (organization_id)', 'USING btree (id)'),
  ];
  for (const modified of denied) {
    assert.notEqual(modified,sql, 'Negative fixture must actually change the source');
    assert.throws(()=>verifyReadOnlyContract(modified));
  }
});

test('0026 preflight rejects any extra permissive policy on a rental table',()=>{
  const source = verifyReadOnlyContract(sql);
  assert.match(source,/extra\.polrelid=t\.oid AND extra\.polpermissive/);
  assert.match(source,/extra\.polname<>t\.initial_policy/);
  assert.match(source,/AND NOT unexpected_permissive_policy_present/);
  for (const modified of [
    sql.replace('AND extra.polpermissive','AND NOT extra.polpermissive'),
    sql.replace('extra.polname<>t.initial_policy','extra.polname=t.initial_policy'),
    sql.replace('AND NOT unexpected_permissive_policy_present',''),
  ]) {
    assert.notEqual(modified,sql);
    assert.throws(()=>verifyReadOnlyContract(modified));
  }
});

test('four approved portal policies are pinned to live SQL predicates and SELECT-only', () => {
  verifyReadOnlyContract(sql);
  const expected = [
    ['leases','leases_owner_portal_select','8edc2a7a4a9fe194979395b5fda9012a62d778604ee87553abbb7e2f0a5f876d'],
    ['leases','leases_tenant_portal_select','1c83a68d500060fa11e84286173c954e3fdf606ac088d423efd262d3a72f99b6'],
    ['owner_statements','owner_statements_external_issued','6f9fa81441bd18f3e1cff94e1eadcd888cfb6810504f66bc0300058ede6cac84'],
    ['rent_payments','rent_payments_external_personal','3cbbecfd27ecc63fc035c57d390f3a6fd446f01150ad9845d09d892cc925ef12'],
  ];
  for(const [table,policy,sha] of expected)
    assert.ok(sql.includes("('"+table+"','"+policy+"','"+sha+"')"),
      'Approved external policy must have its exact production predicate hash: '+policy);
  assert.equal((sql.match(/'[a-f0-9]{64}'\)/g)??[]).length,4);
});

test('portal policy audit fails closed on unknown or weakened permissive policies', () => {
  verifyReadOnlyContract(sql);
  const mutations = [
    sql.replace('AND expected_portal_policy_count=verified_portal_policy_count',
      'AND expected_portal_policy_count>=verified_portal_policy_count'),
    sql.replace("AND extra.polcmd='r' AND extra.polwithcheck IS NULL",
      "AND extra.polcmd='a' AND extra.polwithcheck IS NULL"),
    sql.replace("AND pol.polcmd='r' AND pol.polwithcheck IS NULL",
      "AND pol.polcmd='a' AND pol.polwithcheck IS NULL"),
    sql.replace("extra.polroles=ARRAY['authenticated'::regrole::oid]",
      "extra.polroles=ARRAY['anon'::regrole::oid]"),
    sql.replace("pol.polroles=ARRAY['authenticated'::regrole::oid]",
      "pol.polroles=ARRAY['anon'::regrole::oid]"),
    sql.replace('AND NOT unexpected_permissive_policy_present',''),
    sql.replace("8edc2a7a4a9fe194979395b5fda9012a62d778604ee87553abbb7e2f0a5f876d",
      '0'.repeat(64)),
    sql.replace("=a.using_sha256", "<>a.using_sha256"),
    sql.replace("AND NOT EXISTS (\n           SELECT 1 FROM approved_portal_policies", "AND EXISTS (\n           SELECT 1 FROM approved_portal_policies"),
  ];
  for (const modified of mutations) {
    assert.notEqual(modified,sql,'Adversarial mutation did not change SQL');
    assert.throws(()=>verifyReadOnlyContract(modified),
      /AssertionError|Error/, 'Policy contract must reject mutation');
  }
});
