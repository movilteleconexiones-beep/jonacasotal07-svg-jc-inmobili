import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  auditMigrationBodies, auditRepository, diagnosticNormalize,
  gitBlobSha, trimSql, verifySnapshot,
} from '../scripts/ops/migration-body-fingerprint-audit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = join(root, 'docs/ops/snapshots/supabase-migration-sql-fingerprints-2026-11-03.json');
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const migrations = join(root, 'supabase/migrations');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('authentic production metadata is complete and never exposes SQL bodies', () => {
  const entries = verifySnapshot(snapshot);
  assert.equal(entries.length, 99);
  assert.ok(entries.every(e => e.bytes > 0));
  assert.ok(entries.every(e => Object.keys(e).sort().join(',') ===
    ['version','name','bytes','blob_sha1','body_sha256',
     'trimmed_sha256','no_full_line_comment_whitespace_sha256'].sort().join(',')));
  assert.equal(JSON.stringify(snapshot).includes('CREATE TABLE'), false);
  assert.equal(JSON.stringify(snapshot).includes('CREATE FUNCTION'), false);
  assert.throws(() => verifySnapshot({...snapshot, entries:[entries[0],entries[0]]}), /Duplicate/);
  assert.throws(() => verifySnapshot({...snapshot, contains_sql_bodies:true}), /metadata-only/);
});

test('real 99-statement snapshot gives 80 exact local SQL matches, no speculative deployment approval', () => {
  const report = auditRepository(snapshot, migrations);
  const counts = report.summary;
  assert.deepEqual({
    applied:counts.applied_migrations, local:counts.local_files,
    matched:counts.matched_by_name, missingFromRepo:counts.applied_without_local_name,
    exact:counts.byte_identical, trim:counts.edge_whitespace_only,
    comments:counts.comment_or_whitespace_candidate,
    changed:counts.substantive_sql_difference, unmatched:counts.unmatched_local_name,
  }, {
    applied:99, local:109, matched:86, missingFromRepo:13,
    exact:80, trim:2, comments:2, changed:2, unmatched:23,
  });
  assert.equal(counts.body_equivalence_proven,false);
  assert.equal(counts.migration_push_authorized,false);
  assert.deepEqual(report.results.filter(x => x.classification === 'substantive_sql_difference')
    .map(x => x.filename), [
    '20261010212630_property_consignment_intake.sql',
    '20261010214633_fix_property_portal_rls_recursion.sql',
  ]);
  assert.deepEqual(report.results.filter(x => x.classification === 'edge_whitespace_only')
    .map(x => x.filename), [
    '0022_enable_invitation_rls.sql',
    '20261011000300_independent_owner_trial_entitlements.sql',
  ]);
  assert.deepEqual(report.results.filter(x => x.classification === 'comment_or_whitespace_candidate')
    .map(x => x.filename), [
    '20261012150000_finance_approval_and_audit_timestamp_hardening.sql',
    '20261029171601_revoke_disabled_trial_authorization_rpc.sql',
  ]);
  assert.deepEqual(readdirSync(migrations).filter(x=>x.endsWith('.sql')).length,109);
});

test('fingerprints detect SQL modifications, including renamed comments and relaxed permissions', () => {
  const recorded='-- old comment\nSELECT 1;\n';
  const buffer=Buffer.from(recorded);
  const entry={
    version:'20261012120000',name:'fixture',
    bytes:buffer.length,
    blob_sha1:gitBlobSha(buffer),
    body_sha256:sha256(buffer),
    trimmed_sha256:sha256(trimSql(recorded)),
    no_full_line_comment_whitespace_sha256:sha256(diagnosticNormalize(recorded)),
  };
  const fixture={integrity_only:true,contains_sql_bodies:false,entries:[entry]};
  const check=(sql)=>auditMigrationBodies(fixture,['20261012120000_fixture.sql'],()=>Buffer.from(sql))
    .results[0].classification;
  assert.equal(check(recorded),'byte_identical');
  assert.equal(check(recorded.trim()),'edge_whitespace_only');
  assert.equal(check('-- edited comment\nSELECT 1;\n'),'comment_or_whitespace_candidate');
  assert.equal(check('-- old comment\nSELECT 2;\n'),'substantive_sql_difference');
  assert.equal(check('SELECT 1; -- changed inline behavior'),'substantive_sql_difference');
  assert.throws(()=>auditMigrationBodies(fixture,['not_a_migration.sql'],()=>buffer),/Unexpected local SQL/);
});

test('operational CLI always remains NO-GO despite good or normalized matches', () => {
  const result=spawnSync(process.execPath,[
    join(root,'scripts/ops/migration-body-fingerprint-audit.mjs'),
    '--snapshot',snapshotPath,
  ],{cwd:root,encoding:'utf8',timeout:20_000});
  assert.equal(result.status,2,result.stdout + result.stderr);
  assert.match(result.stdout,/"byte_identical":80/);
  assert.match(result.stderr,/NO-GO:/);
  assert.match(result.stderr,/Do not run db push or migration repair/);
  assert.match(result.stderr,/property_consignment_intake/);
});
