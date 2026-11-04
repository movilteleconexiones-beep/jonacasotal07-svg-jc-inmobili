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
