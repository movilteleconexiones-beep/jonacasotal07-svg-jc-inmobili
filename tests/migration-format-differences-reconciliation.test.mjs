import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { trimSql, verifySnapshot } from '../scripts/ops/migration-body-fingerprint-audit.mjs';

// #104: Retain applied SQL hashes only; never commit the SQL bodies or any
// Supabase credentials. Non-semantic format findings do NOT authorize
// migrations, db push or changing the production ledger.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = JSON.parse(readFileSync(join(
  root, 'docs/ops/snapshots/supabase-migration-sql-fingerprints-2026-11-03.json'), 'utf8'));
const byVersion = new Map(verifySnapshot(snapshot).map(entry => [entry.version, entry]));
const hash = (value) => createHash('sha256').update(value).digest('hex');

const cases = Object.freeze([
  {
    version: '20261005053050', name: '0022_enable_invitation_rls',
    file: '0022_enable_invitation_rls.sql', kind: 'edge',
    appliedSha: '96c5a4b1ee46c0c80102f88a6c1d21a1750fce4b9d2ffa914c3b8f0746751a9f',
    localExtraBoundary: 'leading-line-break',
  },
  {
    version: '20261011002448', name: 'independent_owner_trial_entitlements',
    file: '20261011000300_independent_owner_trial_entitlements.sql', kind: 'edge',
    appliedSha: '410ad098880461864f0211e5c8047526fcc9c5abddd3d49c50e4225165feb9b2',
    localExtraBoundary: 'trailing-line-break',
  },
  {
    version: '20261012071309', name: 'finance_approval_and_audit_timestamp_hardening',
    file: '20261012150000_finance_approval_and_audit_timestamp_hardening.sql',
    kind: 'comment-only',
    appliedSha: '4eab5a0e05dd5a4b5b6ad5bbf13bb9191e47f319bad8aa12ffd97afd8f1012c4',
    appliedCodeSha: '64d21c1bf5222bd9528374cf4a7b0585cf77e51006dae2d763cc47e80218a833',
    appliedCodeChars: 863,
    localFullLineComments: 5,
    allowedCommentPrefixes: ['BEGIN;', 'CREATE FUNCTION public.normalize_owner_deduction_audit_fields()'],
  },
  {
    version: '20261029171601', name: 'revoke_disabled_trial_authorization_rpc',
    file: '20261029171601_revoke_disabled_trial_authorization_rpc.sql',
    kind: 'comment-only',
    appliedSha: 'f23b6148617d334f34b29298ac26afe61607ad3aa38246dc355d8365cdb50dbf',
    appliedCodeSha: '62c553cc32e7675cc55b8f583ecc3ae40314960cab2d5ed95a86bd50b673a7b4',
    appliedCodeChars: 230,
    localFullLineComments: 4,
    allowedCommentPrefixes: ['REVOKE EXECUTE ON FUNCTION public.billing_admin_authorize_trial('],
  },
]);

// Deliberately NOT a general SQL parser. For these two small, manually
// inspected scripts, allow whole-line -- comments only immediately before
// explicitly pinned SQL statement boundaries and outside dollar quotes.
// Whitespace changes inside SQL strings are not accepted as equivalence.
export function inspectedExecutableLines(source, allowedPrefixes) {
  if (!Array.isArray(allowedPrefixes) || !allowedPrefixes.length)
    throw Error('Explicit allowed comment boundaries required');
  const rows = source.split(/\r?\n/);
  const output = [];
  let dollarQuote = null, comments = 0;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('--')) {
      if (dollarQuote) throw Error('Comment inside dollar-quoted SQL body');
      const next = rows.slice(i + 1).map(x => x.trim()).find(x => x && !x.startsWith('--'));
      if (!next || !allowedPrefixes.some(prefix => next.startsWith(prefix)))
        throw Error('Comment outside inspected SQL statement boundary');
      comments++;
      continue;
    }
    if (line.includes('/*') || line.includes('*/'))
      throw Error('Block comments outside reviewed cases');
    // All reviewed SQL dollar markers occur on their own SQL lines; fail
    // closed on unexpected quoting rather than normalizing arbitrary SQL.
    const delimiters = [...line.matchAll(/\$[A-Za-z0-9_]*\$/g)].map(x => x[0]);
    for (const marker of delimiters) {
      if (dollarQuote === null) dollarQuote = marker;
      else if (dollarQuote === marker) dollarQuote = null;
      else throw Error('Unexpected nested dollar-quote marker');
    }
    output.push(trimmed);
  }
  if (dollarQuote) throw Error('Unclosed dollar-quoted body');
  return { code: output.join('\n'), comments };
}

test('four applied hashes remain pinned in authentic 99-row evidence', () => {
  assert.equal(byVersion.size, 99);
  for (const entry of cases) {
    const applied = byVersion.get(entry.version);
    assert.ok(applied, 'Missing applied migration: ' + entry.version);
    assert.equal(applied.name, entry.name);
    assert.equal(applied.body_sha256, entry.appliedSha);
  }
});

test('two applied SQL bodies differ from local source solely by outer whitespace', () => {
  for (const entry of cases.filter(x => x.kind === 'edge')) {
    const file = readFileSync(join(root, 'supabase/migrations', entry.file), 'utf8');
    const applied = byVersion.get(entry.version);
    assert.equal(hash(trimSql(file)), applied.trimmed_sha256, entry.file);
    if (entry.localExtraBoundary === 'leading-line-break')
      assert.ok(!file.startsWith('\n'), 'Expected local source without applied initial break');
    if (entry.localExtraBoundary === 'trailing-line-break')
      assert.ok(file.endsWith('\n\n'), 'Expected one extra local trailing line break');
    assert.notEqual(hash(file), applied.body_sha256, 'Classified a byte-identical file as divergent');
    assert.notEqual(hash(trimSql(file) + '\nSELECT 1;'), applied.trimmed_sha256);
  }
});

test('two original code bodies remain identical after inspected exterior line-comments', () => {
  for (const entry of cases.filter(x => x.kind === 'comment-only')) {
    const file = readFileSync(join(root, 'supabase/migrations', entry.file), 'utf8');
    const result = inspectedExecutableLines(file, entry.allowedCommentPrefixes);
    assert.equal(result.comments, entry.localFullLineComments, entry.file);
    assert.equal(result.code.length, entry.appliedCodeChars, entry.file);
    assert.equal(hash(result.code), entry.appliedCodeSha, entry.file);
    assert.notEqual(hash(file), entry.appliedSha);
    const changed = inspectedExecutableLines(file + '\nSELECT 1;', entry.allowedCommentPrefixes);
    assert.notEqual(hash(changed.code), entry.appliedCodeSha);
  }
});

test('lexical safety rejects unexpected comments inside functions and across statement boundaries', () => {
  const allowed = ['CREATE FUNCTION public.demo()', 'REVOKE EXECUTE'];
  assert.throws(
    () => inspectedExecutableLines('CREATE FUNCTION public.demo() AS $$\n-- hide\nSELECT 1;\n$$;', allowed),
    /inside dollar-quoted/);
  assert.throws(
    () => inspectedExecutableLines('-- unreviewed\nALTER TABLE public.demo ENABLE ROW LEVEL SECURITY;', allowed),
    /outside inspected/);
  assert.throws(() => inspectedExecutableLines('SELECT 1 /* unreviewed */;', allowed), /Block comments/);
});

test('format-equivalence evidence never turns history #104 into GO', () => {
  const names = cases.map(x => x.name);
  assert.equal(names.length, 4);
  assert.ok(names.includes('finance_approval_and_audit_timestamp_hardening'));
  assert.equal(cases.filter(x => x.kind === 'comment-only').length, 2);
  const originalSqlSnapshot = JSON.stringify(snapshot);
  assert.equal(originalSqlSnapshot.includes('ALTER POLICY leases_financial_insert'), false);
  assert.equal(originalSqlSnapshot.includes('CREATE FUNCTION public.normalize_owner_deduction'), false);
  assert.equal(snapshot.contains_sql_bodies, false);
});
