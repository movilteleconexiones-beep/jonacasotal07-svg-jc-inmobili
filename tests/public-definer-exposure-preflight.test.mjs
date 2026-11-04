import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const query = readFileSync(join(root,
  'security/checks/public_definer_exposure_preflight.sql'), 'utf8');

const approved = [
  "('get_public_property_intake_site','p_slug text')",
  "('submit_property_consignment','p_site_slug text, p_request_id uuid, p_payload jsonb')",
  "('submit_public_website_lead','p_slug text, p_name text, p_email text, p_phone text, p_service text, p_message text, p_consent boolean, p_trap text')",
  "('tenant_public_catalog','tenant_slug text')",
];

function verifyReadOnlyPreflight(input) {
  const sql = input.split(/\r?\n/).filter(line =>
    !line.trimStart().startsWith('--')).join('\n').trim();
  assert.match(sql, /^WITH\s+expected\s*\(/i);
  assert.ok(sql.endsWith(';'));
  assert.equal((sql.match(/;(?=\s|$)/g) ?? []).length, 1,
    'Only one SELECT statement is allowed');
  assert.doesNotMatch(sql, /\b(?:FROM|JOIN)\s+(?:public|private|storage|auth|supabase_migrations)\./i,
    'Never read tenant records');
  assert.doesNotMatch(sql, /^\s*(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|DO|COPY|CALL|GRANT|REVOKE|EXECUTE|SET)\b/im,
    'Must not execute DDL/DML');
  assert.doesNotMatch(sql, /\b(?:pg_read_file|dblink|postgres_fdw|pg_ls_dir)\s*\(/i);
  for (const table of ['pg_proc','pg_namespace','pg_roles'])
    assert.match(sql, new RegExp('\\b(?:FROM|JOIN)\\s+' + table + '\\b','i'));
  for (const entry of approved) assert.ok(sql.includes(entry),
    'Approved anonymous RPC signature missing: ' + entry);
  assert.match(sql, /has_function_privilege\('anon',p\.oid,'EXECUTE'\)/);
  assert.match(sql, /has_function_privilege\('authenticated',p\.oid,'EXECUTE'\)/);
  assert.match(sql, /has_schema_privilege\(r\.oid,'public','CREATE'\)/);
  assert.match(sql, /WHERE\s+n\.nspname='public'\s+AND\s+p\.prosecdef/);
  assert.match(sql, /p\.anon_exec\s+AND\s+e\.proname\s+IS\s+NULL/);
  assert.match(sql, /p\.oid\s+IS\s+NULL/);
  assert.match(sql, /'search_path=""'=ANY/);
  assert.match(sql, /p\.anon_exec\s+OR\s+p\.auth_exec/);
  for (const label of [
    'approved_anon_definer_rpc_count','missing_approved_anon_rpcs',
    'unexpected_anon_definer_rpcs','anon_nonempty_or_duplicate_search_path',
    'anon_or_authenticated_can_create_public',
    'exposed_definer_missing_or_duplicate_search_path',
  ]) assert.ok(sql.includes("'" + label + "'"), 'Missing security check: ' + label);
  assert.match(sql, /observed=expected_count THEN 'OK' ELSE 'DRIFT'/);
  return sql;
}

test('public privileged API preflight pins only approved anonymous functions and schema ACL', () => {
  verifyReadOnlyPreflight(query);
  assert.equal(approved.length, 4);
});

test('preflight rejects missing endpoints, weakened comparisons and tenant reads', () => {
  const bad = [
    query.replace(approved[0], "('unsafe_public_rpc','p_slug text')"),
    query.replace('p.anon_exec AND e.proname IS NULL', 'p.anon_exec AND e.proname IS NOT NULL'),
    query.replace("has_schema_privilege(r.oid,'public','CREATE')", 'false'),
    query.replace("'search_path=\"\"'=ANY", "'search_path=public'=ANY"),
    query.replace("observed=expected_count THEN 'OK' ELSE 'DRIFT'",
      "observed>=expected_count THEN 'OK' ELSE 'DRIFT'"),
    query + '\nSELECT * FROM public.leases;',
    query + '\nDELETE FROM supabase_migrations.schema_migrations;',
  ];
  for (const mutated of bad) {
    assert.notEqual(mutated, query, 'Negative fixture must mutate the query');
    assert.throws(() => verifyReadOnlyPreflight(mutated));
  }
});
