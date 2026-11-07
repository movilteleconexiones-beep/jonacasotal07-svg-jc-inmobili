// INMOJCO #104 - offline, historical migration BODY evidence only.
// Never consults production, runs SQL or authorizes db push / migration repair.
import { readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlobSha } from './finance-migration-gate.mjs';
import { historicSqlFile } from './historic-sql-source.mjs';
import { verifyAppliedConsolidation, verifyAppliedHardeningSource } from './finance-hardening-provenance.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const MANIFEST = 'docs/ops/snapshots/migration-source-parity-2026-11-06.json';
export const EXPECTED_CATEGORIES = Object.freeze({
  EXACT: 86, EXACT_HISTORIC_ALIAS: 8, LEADING_NEWLINE_ONLY: 1,
  TRAILING_NEWLINE_ONLY: 1, REVIEWED_NONEXECUTABLE_DIFFERENCE: 2,
  RECONSTRUCTED_FINANCE_4_FILES: 1,
});
const REVOKE_TRIAL_EXECUTABLE = [
  'REVOKE EXECUTE ON FUNCTION public.billing_admin_authorize_trial(',
  '  uuid, uuid, uuid, integer, text',
  ') FROM authenticated;',
  'REVOKE EXECUTE ON FUNCTION public.billing_admin_authorize_trial(',
  '  uuid, uuid, uuid, integer, text',
  ') FROM PUBLIC;',
].join('\n');

function localSource(path) {
  if (typeof path !== 'string' || !/^(supabase\/migrations|docs\/ops\/snapshots)\//.test(path))
    throw Error('Unsafe or unexpected historical source path');
  const full = path.startsWith('supabase/migrations/')
    ? historicSqlFile(root,path.slice('supabase/migrations/'.length))
    : resolve(root,path);
  const pathFromRoot = relative(root, full);
  if (!pathFromRoot || pathFromRoot.startsWith('..' + sep) || pathFromRoot === '..')
    throw Error('Source path escapes repository root');
  return readFileSync(full, 'utf8');
}

export function verifyMigrationSourceParity(manifest, ledger) {
  const problems = [];
  if (!manifest || !Array.isArray(manifest.records) || !ledger || !Array.isArray(ledger.migrations))
    return { ok: false, safeToPush: false, checked: 0, problems: ['Invalid provenance manifest or historical ledger'] };
  if (manifest.safeToPush !== false || manifest.databaseMigrationCount !== 99 ||
      manifest.records.length !== 99 || ledger.migrations.length !== 99)
    problems.push('Historical ledger must be pinned to 99 and explicitly NO-GO');
  const catalog = new Map(ledger.migrations.map(x => [x.version,x.name]));
  const seen = new Set();
  const counts = {};
  for (const record of manifest.records) {
    if (!/^\d{14}$/.test(record.version) || seen.has(record.version))
      problems.push('Missing, duplicate or malformed version: ' + record.version);
    seen.add(record.version);
    if (catalog.get(record.version) !== record.appliedName)
      problems.push('Applied version/name changed: ' + record.version);
    if (!/^[a-f0-9]{40}$/.test(record.appliedSqlGitBlob ?? ''))
      problems.push('Applied SQL source fingerprint malformed: ' + record.version);
    counts[record.category] = (counts[record.category] ?? 0) + 1;
    try {
      if (record.category === 'RECONSTRUCTED_FINANCE_4_FILES') {
        if (record.version !== '20261012070133' || !Array.isArray(record.localSources) ||
            record.localSources.length !== 4 ||
            !verifyAppliedConsolidation(record.localSources.map(localSource)).matchesRecordedSql)
          throw Error('Consolidated finance source differs from the pinned 484-line body');
        continue;
      }
      const source = localSource(record.localPath);
      const fingerprint = gitBlobSha(source);
      if (fingerprint !== record.localGitBlob)
        throw Error('Local source changed from pinned Git blob');
      if (record.category === 'EXACT' || record.category === 'EXACT_HISTORIC_ALIAS') {
        if (fingerprint !== record.appliedSqlGitBlob ||
            Buffer.byteLength(source,'utf8') !== record.appliedSqlBytes)
          throw Error('Recorded production SQL differs byte-for-byte');
      } else if (record.category === 'LEADING_NEWLINE_ONLY') {
        if (record.version !== '20261005053050' ||
            gitBlobSha('\n' + source) !== record.appliedSqlGitBlob ||
            Buffer.byteLength(source,'utf8') + 1 !== record.appliedSqlBytes)
          throw Error('Leading newline-only equivalence failed');
      } else if (record.category === 'TRAILING_NEWLINE_ONLY') {
        if (record.version !== '20261011002448' || !source.endsWith('\n') ||
            gitBlobSha(source.slice(0,-1)) !== record.appliedSqlGitBlob ||
            Buffer.byteLength(source,'utf8') - 1 !== record.appliedSqlBytes)
          throw Error('Trailing newline-only equivalence failed');
      } else if (record.category === 'REVIEWED_NONEXECUTABLE_DIFFERENCE') {
        if (record.version === '20261012071309') {
          if (!verifyAppliedHardeningSource(source).matchesRecordedSql)
            throw Error('Finance hardening statements changed');
        } else if (record.version === '20261029171601') {
          const body = source.replace(/\r\n/g,'\n').split('\n')
            .filter(line => line.trim() && !/^\s*--/.test(line)).join('\n');
          if (body !== REVOKE_TRIAL_EXECUTABLE)
            throw Error('Revoke trial EXECUTE statements changed');
        } else throw Error('Comment-only exception not reviewed');
      } else throw Error('Unknown provenance category: ' + record.category);
    } catch (err) {
      problems.push(record.version + ': ' + err.message);
    }
  }
  for (const [category,n] of Object.entries(EXPECTED_CATEGORIES))
    if (counts[category] !== n) problems.push(category + ' count drift: ' + counts[category]);
  if (Object.keys(counts).length !== Object.keys(EXPECTED_CATEGORIES).length)
    problems.push('Unexpected provenance category');
  if (seen.size !== catalog.size) problems.push('Applied migration history is incomplete');
  return { ok: problems.length === 0, safeToPush: false, checked: seen.size,
    counts, problems,
    releaseBlocker: 'Source history is not a chronologically replayable restoration; #104 NO-GO remains.' };
}

export function verifyPinnedMigrationSources() {
  const manifest = JSON.parse(localSource(MANIFEST));
  const ledger = JSON.parse(localSource('docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json'));
  return verifyMigrationSourceParity(manifest, ledger);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyPinnedMigrationSources();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
  else console.log('99 historical bodies mapped; NEVER execute migration repair or db push without separate restore proof.');
}
