import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * #205 – fail-closed review for NEW migrations only. The historical 99
 * migrations have already been applied; never rewrite them for lint hygiene.
 * This is intentionally a source gate, not a substitute for PG17 / RLS tests.
 */
const root = fileURLToPath(new URL('../../', import.meta.url));
const migrationDir = join(root, 'supabase', 'migrations');
const lastHistoric = '20261031032350';

function auditForwardMigration(sql) {
  const source = sql.replace(/--[^\r\n]*/g, '');
  const errors = [];
  if (/GRANT\s+ALL\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public/i.test(source)) {
    errors.push('Never grant access to every public table');
  }
  const tables = [...source.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(public|private|jco_private)\.)?([a-z_][a-z0-9_]*)\s*\(/gi)];
  for (const match of tables) {
    const schema = match[1]?.toLowerCase();
    const table = match[2].toLowerCase();
    if (!schema) {
      errors.push('New table ' + table + ' must declare its exact schema');
      continue;
    }
    const qualified = schema + '\\.' + table;
    const rls = new RegExp('ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?' + qualified + '\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY', 'i');
    if (!rls.test(source)) errors.push(schema + '.' + table + ' missing explicit RLS');
    // A new table must explicitly deny public access by default. The
    // necessary narrowly scoped GRANTs, if any, are separately reviewed.
    const revoke = new RegExp('REVOKE\\s+ALL\\s+ON\\s+(?:TABLE\\s+)?' + qualified + '\\s+FROM\\s+[^;]*\\b(?:PUBLIC|anon|authenticated)\\b', 'i');
    if (!revoke.test(source)) errors.push(schema + '.' + table + ' missing explicit role REVOKE');
  }
  return { tables: tables.length, errors };
}

test('#205: deployed-forward migrations fail closed for newly created public/private tables', () => {
  const files = readdirSync(migrationDir).filter(name =>
    /^\d{14}_[a-z0-9_]+\.sql$/.test(name) &&
    name.slice(0, 14) > lastHistoric).sort();
  assert.ok(files.length > 0, 'Expected at least CRM migration v100 to be in repository');
  for (const filename of files) {
    const sql = readFileSync(join(migrationDir, filename), 'utf8');
    const result = auditForwardMigration(sql);
    assert.deepEqual(result.errors, [], filename + ': ' + result.errors.join('; '));
  }
});

test('#205: parser rejects missing RLS, public grants and unqualified DDL', () => {
  assert.match(auditForwardMigration('CREATE TABLE public.unsafe (id uuid);').errors.join('; '), /missing explicit RLS/);
  assert.match(auditForwardMigration('CREATE TABLE public.unsafe (id uuid);').errors.join('; '), /missing explicit role REVOKE/);
  assert.match(auditForwardMigration('CREATE TABLE unknown (id uuid);').errors.join('; '), /declare its exact schema/);
  assert.match(auditForwardMigration('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;').errors.join('; '), /Never grant/);
  assert.deepEqual(auditForwardMigration(
    'CREATE TABLE public.good (id uuid); ALTER TABLE public.good ENABLE ROW LEVEL SECURITY; REVOKE ALL ON TABLE public.good FROM PUBLIC,anon,authenticated,service_role;'
  ).errors, []);
});

test('#205: CRM consent receipts stay private, not visible to API roles', () => {
  const sql = readFileSync(join(migrationDir,
    '20261107072304_website_lead_reuse_event_consent.sql'), 'utf8');
  const result = auditForwardMigration(sql);
  assert.equal(result.tables, 1);
  assert.deepEqual(result.errors, []);
  assert.match(sql, /REVOKE ALL ON TABLE private\.website_lead_consents\s+FROM PUBLIC, anon, authenticated, service_role/i);
});
