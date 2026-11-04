import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// #104: static guard for the TWO reviewed, real-production schema fingerprints.
// This deliberately does not parse arbitrary SQL and does not query Supabase.
// When operator executes the SELECT live, expect 14 rows, all finding=OK.
// An offline green test does not imply live schema/restore readiness.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const query = readFileSync(join(root,
  'security/checks/consignment_restore_shape_fingerprint.sql'), 'utf8');

const stripLineComments = s => s.split(/\r?\n/)
  .filter(line => !line.trimStart().startsWith('--')).join('\n');

function verifyReadOnlyCatalogSource(source) {
  const sql = stripLineComments(source).trim();
  assert.match(sql, /^WITH\s+expected\s*\(/i);
  assert.ok(sql.endsWith(';'), 'Expected exactly one reviewed SELECT query');
  assert.equal((sql.match(/;(?=\s|$)/g) ?? []).length, 1, 'Multiple SQL statements');
  // The only FROM/JOIN relations must be catalog relations, catalog-derived
  // in-memory CTEs, or the roles catalog. Never read actual tenant rows.
  assert.doesNotMatch(sql, /\b(?:FROM|JOIN)\s+(?:public|private|auth|storage|supabase_migrations)\./i);
  assert.doesNotMatch(sql, /^\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|MERGE|DO|CALL|EXECUTE|COPY|GRANT|REVOKE|SET|RESET|VACUUM|ANALYZE|REFRESH)\b/im);
  assert.doesNotMatch(sql, /(?:pg_read_file|pg_ls_dir|COPY\s+.*PROGRAM|dblink|postgres_fdw)/i);
  assert.match(sql, /\b(?:FROM|JOIN)\s+pg_class\s+c\b/);
  assert.match(sql, /\bFROM\s+pg_attribute\s+a\b/);
  assert.match(sql, /\bFROM\s+pg_constraint\s+co\b/);
  assert.match(sql, /\bFROM\s+pg_index\s+idx\b/);
  assert.match(sql, /\bFROM\s+pg_policy\s+pol\b/);
  assert.match(sql, /\bFROM\s+pg_trigger\s+tg\b/);
  assert.match(sql, /has_table_privilege\('anon'/);
  assert.match(sql, /has_table_privilege\('service_role'/);
}

test('read-only shape audit targets only the two consignment tables with missing DDL provenance', () => {
  verifyReadOnlyCatalogSource(query);
  assert.match(query, /'private\.property_intake_sites'/);
  assert.match(query, /'public\.property_consignments'/);
  for (const part of ['CATALOG_IDENTITY','COLUMNS','CONSTRAINTS','INDEXES',
                      'POLICIES','TRIGGERS','ACL'])
    assert.match(query, new RegExp("'" + part + "'"), part);
  assert.match(query, /extensions\.digest\(/);
  assert.match(query, /'sha256'/);
  assert.match(query, /rlrowsecurity/);
  assert.match(query, /relforcerowsecurity/);
});

test('real production fingerprints are immutable and contain no SQL body', () => {
  const hashes = query.match(/'[0-9a-f]{64}'/g) ?? [];
  assert.equal(hashes.length, 12, 'Expected six SHA-256 fingerprints per relation');
  for (const pinned of [
    '3f4cf8f06a37a75487bb17161e1993bd0fb1cdba5ec03beb341ced2d5b5aafe5',
    'f7b8a75e1670fc8728a3abbf53f7e79927201a0a62db86de35940aa07bb88a17',
    '721d8491d8610b45708705f1f74659b243fe0c1d6e70bfca387ca6482a3a5176',
    'f04514ac965e941ea60786cdacbce638e028ee22309a5d00a8158d0f98324b8a',
    '1aecff8f509264945fa87d193f9512d407a9636ed55f9d275b99b1eacd3cd4e4',
    '53934ed53fde0809abf3cafd07e1382d8427d0e8719ce4df599622a4e92277e0',
    '98cf9518c182a65f92432189b60575483d95257ea4b7f614e6443c0ade450773',
  ]) assert.ok(hashes.includes("'" + pinned + "'"), 'Lost pinned structural hash: ' + pinned);
  assert.doesNotMatch(query, /(?:password|secret|access_token)\s*=/i);
});

test('read-only SQL contract refuses tenant reads or any accidental schema mutation', () => {
  for (const bad of [
    '\nDELETE FROM public.property_consignments;',
    '\nSELECT * FROM private.property_intake_sites;',
    '\nALTER TABLE public.property_consignments DISABLE ROW LEVEL SECURITY;',
    '\nDROP TABLE public.property_consignments;',
    '\nUPDATE supabase_migrations.schema_migrations SET version = version;',
    '\nSELECT 1;'
  ]) assert.throws(() => verifyReadOnlyCatalogSource(query + bad));
});

test('operator output must be full 14-component evidence, never unconditional GO', () => {
  const names = ['ACL','CATALOG_IDENTITY','COLUMNS','CONSTRAINTS','INDEXES','POLICIES','TRIGGERS'];
  const synthetic = ['private.property_intake_sites','public.property_consignments']
    .flatMap(identifier => names.map(component => ({identifier,component,finding:'OK'})));
  const validateOutput = rows =>
    rows.length === 14 &&
    ['private.property_intake_sites','public.property_consignments'].every(identifier =>
      names.every(component =>
        rows.filter(row=>row.identifier===identifier && row.component===component && row.finding==='OK').length===1));
  assert.ok(validateOutput(synthetic));
  assert.equal(validateOutput(synthetic.slice(1)), false);
  assert.equal(validateOutput(synthetic.map((r,i)=>i===0?{...r,finding:'DRIFT'}:r)),false);
  assert.equal(validateOutput([...synthetic, synthetic[0]]),false);
  assert.match(query,/not prove[s]? historical DDL origin|NEVER reads tenant records/i);
});
