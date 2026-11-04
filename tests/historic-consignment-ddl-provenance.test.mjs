import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = join(root, 'security/checks/consignment_ddl_provenance_live_catalog.sql');
const sql = readFileSync(path, 'utf8');

// This is NOT a general SQL parser. A fail-closed static guard for one
// reviewed SELECT-only catalog scanner. A missing source CREATE TABLE
// signature must not be mistaken for proof of manual DDL or DB corruption.
function assertReadOnlyQuery(source) {
  const noComments = source.split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join('\n').trim();
  assert.match(noComments, /^WITH\s+expected\s*\(/i);
  assert.ok(noComments.endsWith(';'));
  const banned = /^\s*(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|REVOKE|GRANT|DO|CALL|COPY|SET|SELECT\s+.*\bINTO\b)\b/mi;
  assert.doesNotMatch(noComments, banned);
  assert.doesNotMatch(noComments, /(?:pg_read_file|pg_ls_dir|COPY\s+.*PROGRAM)/i);
  assert.match(noComments, /FROM\s+supabase_migrations\.schema_migrations/i);
  assert.match(noComments, /to_regclass\(e\.object_ref\)/i);
  assert.match(noComments, /to_regprocedure\(e\.signature\)/i);
}

test('consignment origin scan is SELECT-only and references the actual applied ledger', () => {
  assertReadOnlyQuery(sql);
  for (const object of [
    'private.property_intake_sites',
    'public.property_consignments',
    'private.can_read_portal_property',
    'public.get_public_property_intake_site',
    'public.submit_property_consignment',
  ]) {
    assert.ok(sql.includes(object), 'Missing provenance target: ' + object);
  }
  assert.match(sql, /direct_create_matches/);
  assert.match(sql, /direct_create_migrations/);
  assert.match(sql, /currently_present/);
  assert.match(sql, /jsonb_agg/);
});

test('the scanner fails closed on appended DDL/DML and cannot be used as a repair recipe', () => {
  for (const operation of [
    'DROP TABLE public.property_consignments;',
    'ALTER TABLE public.property_consignments DISABLE ROW LEVEL SECURITY;',
    'INSERT INTO public.property_consignments DEFAULT VALUES;',
    'UPDATE public.property_consignments SET organization_id = NULL;',
    'DELETE FROM supabase_migrations.schema_migrations;',
  ]) {
    assert.throws(() => assertReadOnlyQuery(sql + '\n' + operation));
  }
});

test('exposes provenance limits, never claims out-of-band DDL or SQL equivalence', () => {
  assert.match(sql, /NOT dynamic EXECUTE/i);
  assert.match(sql, /Never assume a missing direct match means the object never existed/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+supabase_migrations\.schema_migrations\s*\(/i);
});
