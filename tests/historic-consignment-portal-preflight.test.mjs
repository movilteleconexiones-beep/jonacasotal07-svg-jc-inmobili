// Offline contract guard for the live read-only historical preflight.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(resolve(root,'security/checks/consignment_portal_20261010_preflight_live_catalog.sql'),'utf8');
const expected=[
  'consignment.private_site_table','consignment.public_queue_table',
  'consignment.public_site_rpc','consignment.public_submit_rpc','consignment.review_rpc',
  'consignment.queue_rls','consignment.private_site_rls',
  'consignment.anon_no_site_read','consignment.auth_no_queue_insert',
  'consignment.anon_submit_execute','consignment.queue_read_policy',
  'consignment.six_indexes','recursion.helper_exists',
  'recursion.properties_select_uses_helper','recursion.ownerships_select_policy',
  'recursion.anon_no_helper_execute',
].sort();

// Guard that can also be applied to a tampered copy during negative tests.
function checkReadOnlyContract(sql){
  const executable=sql.replace(/^\s*--[^\n]*$/gm,'')
    .replace(/'(?:''|[^'])*'/g,"''").trim();
  assert.match(executable,/^WITH\s+checks\s*\(/i);
  assert.match(executable,/SELECT\s+check_id\s*,\s*CASE\s+WHEN\s+passed\s+THEN/i);
  assert.match(executable,/FROM\s+checks\s+ORDER\s+BY\s+check_id\s*;$/i);
  assert.equal((executable.match(/;/g)??[]).length,1,'single read-only SELECT statement required');
  assert.doesNotMatch(executable,/\b(?:INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|CREATE\s+|ALTER\s+|DROP\s+|TRUNCATE\s+|GRANT\s+|REVOKE\s+|NOTIFY\s+|COPY\s+|DO\s+\$|SET\s+ROLE\b|SELECT\s+INTO\b|PERFORM\s+)\b/i);
  const ids=[...sql.matchAll(/'((?:consignment|recursion)\.[a-z_]+)'\s*,/g)].map(m=>m[1]).sort();
  assert.deepEqual(ids,expected,'exactly 16 historical checks must remain');
  assert.match(sql,/\bCOALESCE\(NOT has_table_privilege\('anon'/);
  assert.match(sql,/\bCOALESCE\(NOT has_function_privilege\('anon'/);
  assert.match(sql,/\bpg_get_expr\(p\.polqual,p\.polrelid\)/);
  assert.match(sql,/\bcount\(\*\) FROM pg_indexes\b/);
  return true;
}

test('16 live catalogue checks are fail-closed, read-only and complete',()=>{
  assert.equal(checkReadOnlyContract(source),true);
});

test('unsafe SQL statements and removed checks are rejected offline',()=>{
  assert.throws(()=>checkReadOnlyContract(source.replace('FROM checks ORDER BY check_id;', 'FROM checks ORDER BY check_id; DROP TABLE public.properties;')));
  assert.throws(()=>checkReadOnlyContract(source.replace("'recursion.helper_exists',", "'recursion.helper_absent',")));
  assert.throws(()=>checkReadOnlyContract(source.replace('COALESCE(NOT has_function_privilege','COALESCE(has_function_privilege')));
});
