import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const query = readFileSync(join(root,
  'security/checks/finance_20261012_original_object_manifest_live.sql'),'utf8');

function verifyOnlyCatalog(source) {
  const sql = source.split(/\r?\n/)
    .filter(line=>!line.trimStart().startsWith('--')).join('\n').trim();
  assert.match(sql,/^WITH\s+expected\s*\(/i);
  assert.ok(sql.endsWith(';'));
  assert.equal((sql.match(/;(?=\s|$)/g)??[]).length,1);
  assert.doesNotMatch(sql,/\b(?:FROM|JOIN)\s+(?:public|private|storage|auth|supabase_migrations)\./i);
  assert.doesNotMatch(sql,/^\s*(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|DO|COPY|SET|CALL|REVOKE|GRANT|EXECUTE)\b/im);
  for(const catalogue of ['pg_proc','pg_namespace','pg_policy','pg_trigger','pg_index','pg_class'])
    assert.match(sql,new RegExp('\\b(?:FROM|JOIN)\\s+'+catalogue+'\\b','i'));
  assert.match(sql,/to_regclass\('public\.'\|\|expected\.parent\)/);
  return sql;
}

test('applied consolidated finance source is represented by 19 pinned identities, no production SQL bodies',()=>{
  const s=verifyOnlyCatalog(query);
  const rows=[...s.matchAll(/\('(table|function|policy|trigger|index)','([a-z_]+)','([a-z_]*)'\)/g)];
  assert.equal(rows.length,19);
  for(const [category,amount] of Object.entries({table:2,function:5,policy:9,trigger:1,index:2}))
    assert.equal(rows.filter(row=>row[1]===category).length,amount,category);
  const keys=new Set(rows.map(row=>row.slice(1,4).join('/')));
  assert.equal(keys.size,19,'no identity may be counted twice');
  for(const name of [
    'public.owner_statement_deductions','public.rent_receipts'
  ]) assert.ok(query.includes(name.split('.')[1]));
  assert.match(query,/t\.tgenabled<>'D'/);
  assert.match(query,/i\.indisvalid/);
});

test('financial lineage audit rejects injected business-row reads or mutations',()=>{
  for(const adversary of [
    '\nSELECT * FROM public.rent_receipts;',
    '\nDELETE FROM public.owner_statement_deductions;',
    '\nALTER TABLE public.leases DISABLE ROW LEVEL SECURITY;',
    '\nUPDATE supabase_migrations.schema_migrations SET name=name;',
    '\nSELECT 1;',
  ]) assert.throws(()=>verifyOnlyCatalog(query+adversary));
});

test('financial manifest cannot claim complete historical DDL equivalence',()=>{
  assert.match(query,/NOT proof of identical definitions/);
  assert.match(query,/No tenant rows, no Auth content, no DDL\/DML/);
  assert.doesNotMatch(query,/INSERT\s+INTO\s+supabase_migrations\./i);
});
