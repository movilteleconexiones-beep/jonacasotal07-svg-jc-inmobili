import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Supabase defaults change on 2026-10-30. Review every future public
// table's RLS and API privileges explicitly instead of relying on grants.
const migrationsDir = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const cutoff = '20261021000000';
const escapeRegex = value => value.replace(/[.*+?^{}()|[\]\\]/g, '\\$&');

function findUnsafePublicTables(raw) {
  const sql = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '');
  const issues = [];
  const pattern = /\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(public|private|auth|storage|jco_private)\.)?([A-Za-z_][A-Za-z_0-9]*)\s*\(/gi;
  for (const match of sql.matchAll(pattern)) {
    const schema = (match[1] || 'public').toLowerCase();
    if (schema !== 'public') continue;
    const table = escapeRegex(match[2]);
    const qualified = '(?:public\\.)?' + table;
    if (!new RegExp('\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?'+qualified+'\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\b', 'i').test(sql)) {
      issues.push(match[2] + ': missing explicit ENABLE ROW LEVEL SECURITY');
    }
    // Explicitly revoke legacy/default grants. Any later GRANT in the migration
    // should intentionally enumerate the role/operations required by the UI.
    const revoke = [...sql.matchAll(new RegExp('\\bREVOKE\\s+ALL\\s+ON\\s+(?:TABLE\\s+)?'+qualified+'\\s+FROM\\s+([^;]+);', 'gi'))];
    const safe = revoke.some(item => ['PUBLIC','anon','authenticated'].every(role =>
      new RegExp('(?:^|[,\\s])'+role+'(?:[,\\s]|$)','i').test(item[1])
    ));
    if (!safe) issues.push(match[2] + ': missing explicit REVOKE ALL FROM PUBLIC, anon, authenticated');
  }
  return issues;
}

test('future public tables always declare their RLS and API privilege boundary', () => {
  const migrations = readdirSync(migrationsDir).filter(name =>
    /^\d{14}_.+\.sql$/.test(name) && name.slice(0,14) >= cutoff);
  const errors = migrations.flatMap(name =>
    findUnsafePublicTables(readFileSync(join(migrationsDir,name),'utf8')).map(issue => name+': '+issue)
  );
  assert.deepEqual(errors, []);
});

test('migration guard rejects unsafe legacy grants, but permits internal tables', () => {
  const good = `CREATE TABLE public.customer_links (id uuid PRIMARY KEY);
    ALTER TABLE public.customer_links ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.customer_links FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON public.customer_links TO authenticated;`;
  assert.deepEqual(findUnsafePublicTables(good), []);
  assert.equal(findUnsafePublicTables('CREATE TABLE public.clients (id uuid);').length,2);
  assert.deepEqual(findUnsafePublicTables('CREATE TABLE private.receipts (id uuid);'),[]);
  assert.equal(findUnsafePublicTables(good.replace(/REVOKE ALL[^;]+;/,'')).length,1);
  assert.equal(findUnsafePublicTables(good.replace(/ALTER TABLE[^;]+;/,'')).length,1);
});
