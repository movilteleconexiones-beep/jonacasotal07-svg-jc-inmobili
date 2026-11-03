// INMOJCO #104: offline comparison of authentic Supabase migration SQL body
// fingerprints against local files. Never executes SQL or uses credentials.
// WARNING: exact bytes are meaningful; whitespace/comment matches are clues,
// not proof that two SQL scripts have identical runtime behavior.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SQL_FILENAME = /^(\d{14}|\d{4})_([A-Za-z0-9_]+)\.sql$/;
const DEFAULT_SNAPSHOT = 'docs/ops/snapshots/supabase-migration-sql-fingerprints-2026-11-03.json';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function gitBlobSha(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return createHash('sha1')
    .update('blob ' + bytes.length + '\0')
    .update(bytes)
    .digest('hex');
}

// Match the SQL snapshot's PostgreSQL btrim(body, E' \\t\\n\\r') convention.
export const trimSql = (sql) => sql.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '');

// Diagnostic normalization: drop only full-line "--" comments, trim each
// line and collapse spacing. It may change semantics inside quoted strings,
// so NEVER treat a match here as authorization to apply a migration.
export function diagnosticNormalize(sql) {
  return sql.split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('--'))
    .map((line) => line.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function verifySnapshot(snapshot) {
  if (snapshot?.integrity_only !== true || snapshot?.contains_sql_bodies !== false
      || !Array.isArray(snapshot.entries)) {
    throw Error('Expected a metadata-only Supabase migration fingerprint snapshot');
  }
  const names = new Set(), versions = new Set();
  for (const entry of snapshot.entries) {
    if (!/^\d{14}$/.test(entry?.version ?? '') ||
        !/^[A-Za-z0-9_]+$/.test(entry?.name ?? '') ||
        !Number.isInteger(entry?.bytes) || entry.bytes < 0 ||
        !HEX40.test(entry?.blob_sha1 ?? '') ||
        !HEX64.test(entry?.body_sha256 ?? '') ||
        !HEX64.test(entry?.trimmed_sha256 ?? '') ||
        !HEX64.test(entry?.no_full_line_comment_whitespace_sha256 ?? '')) {
      throw Error('Invalid SQL metadata-only migration fingerprint entry');
    }
    if (versions.has(entry.version) || names.has(entry.name)) {
      throw Error('Duplicate migration version or name in fingerprint snapshot');
    }
    versions.add(entry.version);
    names.add(entry.name);
  }
  return snapshot.entries;
}

export function auditMigrationBodies(snapshot, files, loadFile) {
  const applied = verifySnapshot(snapshot);
  if (!Array.isArray(files) || typeof loadFile !== 'function')
    throw Error('Expected filenames and a local byte-loading callback');
  const appliedByName = new Map(applied.map((r) => [r.name, r]));
  const used = new Set(), paths = new Set();
  const results = [];
  for (const filename of [...files].filter((s) => s.endsWith('.sql')).sort()) {
    if (paths.has(filename)) throw Error('Duplicate local migration filename');
    paths.add(filename);
    const match = SQL_FILENAME.exec(filename);
    if (!match) throw Error('Unexpected local SQL migration filename: ' + filename);
    const [, version, stem] = match;
    const appliedName = version.length === 4 ? version + '_' + stem : stem;
    const entry = appliedByName.get(appliedName);
    if (!entry) {
      results.push({ filename, classification: 'unmatched_local_name' });
      continue;
    }
    if (used.has(entry.version)) throw Error('Two local files map to one applied statement: ' + appliedName);
    used.add(entry.version);
    const localBuffer = loadFile(filename);
    if (!Buffer.isBuffer(localBuffer)) throw Error('Expected raw file bytes for ' + filename);
    const sql = localBuffer.toString('utf8');
    let classification;
    if (gitBlobSha(localBuffer) === entry.blob_sha1 &&
        sha256(localBuffer) === entry.body_sha256 &&
        localBuffer.length === entry.bytes) {
      classification = 'byte_identical';
    } else if (sha256(trimSql(sql)) === entry.trimmed_sha256) {
      classification = 'edge_whitespace_only';
    } else if (sha256(diagnosticNormalize(sql)) === entry.no_full_line_comment_whitespace_sha256) {
      classification = 'comment_or_whitespace_candidate';
    } else {
      classification = 'substantive_sql_difference';
    }
    results.push({ filename, applied_version: entry.version, classification });
  }
  const kinds = ['byte_identical','edge_whitespace_only','comment_or_whitespace_candidate',
    'substantive_sql_difference','unmatched_local_name'];
  const summary = Object.fromEntries(kinds.map((name) => [name, results.filter((x) => x.classification === name).length]));
  summary.local_files = results.length;
  summary.applied_migrations = applied.length;
  summary.applied_without_local_name = applied.length - used.size;
  summary.matched_by_name = used.size;
  summary.body_equivalence_proven = false;
  summary.migration_push_authorized = false;
  return { summary, results };
}

export function auditRepository(snapshot, migrationDirectory) {
  return auditMigrationBodies(snapshot,
    readdirSync(migrationDirectory), (filename) => readFileSync(join(migrationDirectory, filename)));
}

function main(args) {
  const at = args.indexOf('--snapshot');
  if (at !== -1 && !args[at + 1]) throw Error('--snapshot requires a JSON path');
  const snapshotPath = resolve(at === -1 ? DEFAULT_SNAPSHOT : args[at + 1]);
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const report = auditRepository(snapshot, resolve('supabase/migrations'));
  const s = report.summary;
  console.log('Supabase SQL fingerprint audit (metadata-only, offline): ' + JSON.stringify(s));
  for (const row of report.results.filter(x => x.classification === 'substantive_sql_difference'))
    console.error('SUBSTANTIVE SQL DIFFERENCE: ' + row.filename + ' (recorded as ' + row.applied_version + ')');
  console.error('NO-GO: names or SQL body fingerprints do not prove complete live DDL equivalence.');
  console.error('Do not run db push or migration repair before issue #104 is resolved.');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error('Migration audit error: ' + e.message); process.exitCode = 2; }
}
