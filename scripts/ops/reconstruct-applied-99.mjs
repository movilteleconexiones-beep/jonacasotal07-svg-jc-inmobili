// INMOJCO #104: reconstruct 99 exact historic SQL bodies from pinned sources.
// This is a FILE ARCHIVE for isolated research, not a migration runner.
// No network, Postgres connections, credentials, DDL or modification of production.
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, relative, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gitBlobSha } from './finance-migration-gate.mjs';
import { verifyPinnedMigrationSources } from './migration-source-parity-gate.mjs';

const root = realpathSync(fileURLToPath(new URL('../..', import.meta.url)));
const manifestPath = 'docs/ops/snapshots/migration-source-parity-2026-11-06.json';
const ledgerPath = 'docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json';
const originalExceptions = Object.freeze({
  '20261012070133':
    'docs/ops/snapshots/applied-original-20261012070133-audited_rent_receipts_owner_deductions_finance_permissions.sql',
  '20261012071309':
    'docs/ops/snapshots/applied-original-20261012071309-finance_approval_and_audit_timestamp_hardening.sql',
  '20261029171601':
    'docs/ops/snapshots/applied-original-20261029171601-revoke_disabled_trial_authorization_rpc.sql',
});

function readPinnedSource(path) {
  if (typeof path !== 'string' ||
      !/^(?:supabase\/migrations|docs\/ops\/snapshots)\/[A-Za-z0-9_.-]+$/.test(path))
    throw new Error('Unreviewed historical SQL path');
  const absolute = realpathSync(resolve(root, path));
  const rel = relative(root, absolute);
  if (!rel || rel === '..' || rel.startsWith('..' + sep))
    throw new Error('Historical SQL source escapes repository');
  return readFileSync(absolute, 'utf8');
}

export function materializeAppliedBody(record) {
  const {version, category, appliedSqlGitBlob, appliedSqlBytes} = record ?? {};
  if (!/^\d{14}$/.test(version ?? '') || !/^[a-f0-9]{40}$/.test(appliedSqlGitBlob ?? ''))
    throw new Error('Invalid historical body metadata');
  let sql;
  if (category === 'RECONSTRUCTED_FINANCE_4_FILES' ||
      category === 'REVIEWED_NONEXECUTABLE_DIFFERENCE') {
    if (!originalExceptions[version]) throw new Error('Unpinned original SQL exception');
    sql = readPinnedSource(originalExceptions[version]);
  } else {
    if (!['EXACT','EXACT_HISTORIC_ALIAS',
          'LEADING_NEWLINE_ONLY','TRAILING_NEWLINE_ONLY'].includes(category))
      throw new Error('Unreviewed historical SQL normalization');
    sql = readPinnedSource(record.localPath);
    if (record.localGitBlob !== gitBlobSha(sql))
      throw new Error('Local SQL source changed before reconstruction: ' + version);
    if (category === 'LEADING_NEWLINE_ONLY') {
      if (version !== '20261005053050') throw new Error('Unexpected leading-newline exception');
      sql = '\n' + sql;
    }
    if (category === 'TRAILING_NEWLINE_ONLY') {
      if (version !== '20261011002448' || !sql.endsWith('\n'))
        throw new Error('Unexpected trailing-newline exception');
      sql = sql.slice(0, -1);
    }
  }
  const bytes = Buffer.byteLength(sql,'utf8');
  if (bytes !== appliedSqlBytes || gitBlobSha(sql) !== appliedSqlGitBlob)
    throw new Error('Original applied SQL body mismatch: ' + version);
  return sql;
}

export function buildHistoricalArchive(manifest, ledger) {
  if (!manifest || !Array.isArray(manifest.records) ||
      !ledger || !Array.isArray(ledger.migrations) ||
      manifest.safeToPush !== false || manifest.databaseMigrationCount !== 99 ||
      manifest.records.length !== 99 || ledger.migrations.length !== 99)
    throw new Error('Missing or unreviewed 99-version production snapshots');
  const unique = new Set();
  const records = new Map(manifest.records.map(r=>[r.version,r]));
  if (records.size !== 99) throw new Error('Duplicate original migration version');
  const bodies = [];
  for (const applied of ledger.migrations) {
    if (!/^\d{14}$/.test(applied.version) ||
        !/^[a-z0-9_]+$/.test(applied.name) ||
        unique.has(applied.version)) throw new Error('Malformed or repeated ledger identity');
    if (unique.size && applied.version <= bodies.at(-1).version)
      throw new Error('Applied SQL ledger is out of chronological order');
    unique.add(applied.version);
    const original = records.get(applied.version);
    if (!original || original.appliedName !== applied.name)
      throw new Error('Applied historical name/version has no pinned SQL source');
    bodies.push({
      version:applied.version, name:applied.name,
      sha:original.appliedSqlGitBlob, bytes:original.appliedSqlBytes,
      sql:materializeAppliedBody(original),
    });
  }
  const total = bodies.reduce((n,b)=>n+b.bytes,0);
  if (total !== 493999) throw new Error('Historic SQL total bytes no longer match reviewed baseline');
  return { ok:true,safeToPush:false,safeToRepair:false,safeToReplay:false,
    count:bodies.length,bytes:total,bodies };
}

export function buildPinnedHistoricalArchive() {
  const proof=verifyPinnedMigrationSources();
  if (!proof.ok) throw new Error('Historical source parity gate failed: '+proof.problems.join('; '));
  const manifest=JSON.parse(readPinnedSource(manifestPath));
  const ledger=JSON.parse(readPinnedSource(ledgerPath));
  return buildHistoricalArchive(manifest,ledger);
}

// Optional local archival materialization. Output directory is unconditionally an
// OS temp directory, never supabase/migrations and never a user-supplied path.
export function writeDisposableArchive(archive) {
  if (!archive?.ok || archive?.count !== 99 || archive.safeToPush !== false ||
      archive.safeToRepair !== false || archive.safeToReplay !== false)
    throw new Error('Unreviewed archive cannot be materialized');
  const path=mkdtempSync(join(tmpdir(),'inmojco-104-historic-sql-'));
  const bodyDir=join(path,'readonly-sql');
  mkdirSync(bodyDir);
  const summaries=[];
  for (const item of archive.bodies) {
    if (!/^\d{14}$/.test(item.version) || !/^[a-z0-9_]+$/.test(item.name) ||
        gitBlobSha(item.sql)!==item.sha || Buffer.byteLength(item.sql,'utf8')!==item.bytes)
      throw new Error('Historical SQL was modified before archiving');
    const filename=item.version+'_'+item.name+'.sql.txt';
    writeFileSync(join(bodyDir,filename),item.sql,{flag:'wx',mode:0o600});
    summaries.push({version:item.version,name:item.name,filename,bytes:item.bytes,sha:item.sha});
  }
  writeFileSync(join(path,'MANIFEST.json'),
    JSON.stringify({safeToPush:false,safeToRepair:false,safeToReplay:false,
      count:99,bytes:archive.bytes,summaries},null,2)+'\n',{flag:'wx',mode:0o600});
  return {path,count:summaries.length,bytes:archive.bytes,safeToPush:false};
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const archive=buildPinnedHistoricalArchive();
  const materialize=process.argv.slice(2);
  if (materialize.length>1 || (materialize.length===1 && materialize[0]!=='--archive-temporary'))
    throw new Error('Usage: node scripts/ops/reconstruct-applied-99.mjs [--archive-temporary]');
  // Only the checked option above writes temporary SQL *text*, never executes it.
  const local=materialize.length?writeDisposableArchive(archive):null;
  console.log(JSON.stringify({ok:archive.ok,safeToPush:false,safeToRepair:false,
    safeToReplay:false,originalBodies:archive.count,bytes:archive.bytes,
    localArchive:local?.path??null},null,2));
}
