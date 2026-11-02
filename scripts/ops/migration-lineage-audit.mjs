// INMOJCO migration lineage: offline, read-only metadata classification.
// NAME matches are investigation hints, never proof of SQL/DDL equivalence.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = /^[0-9]{14}$/;
const SQL_FILE = /^([0-9]{14}|[0-9]{4})_([A-Za-z0-9_]+)[.]sql$/;
const LEGACY_SANDBOX_DRAFT = /^00(?:2[6-9]|3[0-2])_/;

export function buildMigrationLineage(sqlFiles, appliedRows) {
  if (!Array.isArray(sqlFiles) || !Array.isArray(appliedRows))
    throw Error('Expected local .sql filenames and applied migration array');
  const appliedNames = new Map();
  const appliedVersions = new Set();
  for (const row of appliedRows) {
    if (!row || !VERSION.test(row.version) || !/^[A-Za-z0-9_]+$/.test(row.name ?? ''))
      throw Error('Invalid applied migration version/name');
    if (appliedVersions.has(row.version)) throw Error('Duplicate applied version: ' + row.version);
    appliedVersions.add(row.version);
    appliedNames.set(row.name, [...(appliedNames.get(row.name) ?? []), row]);
  }
  const filenames = new Set();
  const localVersions = new Map();
  const results = [];
  for (const filename of sqlFiles.filter((f) => f.endsWith('.sql')).sort()) {
    if (filenames.has(filename)) throw Error('Duplicate local filename: ' + filename);
    filenames.add(filename);
    const match = SQL_FILE.exec(filename);
    if (!match) throw Error('Unexpected migration filename: ' + filename);
    const [, version, stem] = match;
    const legacy = version.length === 4;
    if (!legacy)
      localVersions.set(version, [...(localVersions.get(version) ?? []), filename]);
    const candidates = appliedNames.get(legacy ? version + '_' + stem : stem) ?? [];
    let classification;
    if (candidates.length > 1) classification = 'ambiguous-applied-name';
    else if (candidates.length === 1 && version === candidates[0].version)
      classification = 'exact-version-and-name';
    else if (candidates.length === 1)
      classification = legacy ? 'legacy-name-match-only' : 'retimed-name-match-only';
    else if (legacy && LEGACY_SANDBOX_DRAFT.test(filename))
      classification = 'unapplied-legacy-draft';
    else classification = 'unmatched-local-name';
    results.push({
      filename, version, applied_name: legacy ? version + '_' + stem : stem,
      classification,
      candidates: candidates.map(({version, name}) => ({version, name})),
    });
  }
  const matchedNames = new Set(results.filter((r) => r.candidates.length).map((r) => r.applied_name));
  const appliedWithoutLocalName = appliedRows.filter((r) => !matchedNames.has(r.name));
  const versionCollisions = [...localVersions.entries()]
    .filter(([,files]) => files.length > 1)
    .map(([version,files]) => ({version, filenames:files}));
  const counts = {};
  for (const r of results) counts[r.classification] = (counts[r.classification] ?? 0) + 1;
  return {
    summary: {
      local_files: results.length,
      applied_migrations: appliedRows.length,
      ...counts,
      applied_without_local_name: appliedWithoutLocalName.length,
      duplicate_local_versions: versionCollisions.length,
    },
    results, applied_without_local_name: appliedWithoutLocalName,
    version_collisions:versionCollisions,
    sql_equivalence_verified:false,
    migration_push_authorized:false,
  };
}

function main(args) {
  const ix = args.indexOf('--ledger');
  if (ix === -1 || !args[ix + 1]) throw Error('Usage: node migration-lineage-audit.mjs --ledger <read-only JSON snapshot>');
  if (args.some((arg) => ['--apply','--repair','--push','--execute'].includes(arg)))
    throw Error('Refusing database mutation options; this tool is read-only');
  const file = resolve(args[ix + 1]);
  const payload = JSON.parse(readFileSync(file,'utf8'));
  if (!payload || !Array.isArray(payload.migrations)) throw Error('Expected {migrations:[{version,name}]}');
  const dir = resolve('supabase/migrations');
  const report = buildMigrationLineage(readdirSync(dir),payload.migrations);
  if (args.includes('--json')) process.stdout.write(JSON.stringify(report,null,2) + '\n');
  else {
    for (const [name,count] of Object.entries(report.summary)) console.log(name+': '+count);
    console.log('NO-GO: name/version matches do NOT establish DDL, RLS, grants or safe migration repair.');
  }
  // Successful classification means the audit ran, NOT that db push is allowed.
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
