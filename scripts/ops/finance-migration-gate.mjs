// INMOJCO: fail-closed preflight for historic financial migration drift.
// No network, credentials, SQL execution, or production writes.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REVIEWED_FINANCE_MIGRATIONS = Object.freeze([
  { version: '20261012120000', filename: '20261012120000_owner_statement_deduction_lines.sql', blob: '5e7a681c12fb879b2e8d6e65c532c300220b727a' },
  { version: '20261012130000', filename: '20261012130000_rent_receipts_and_owner_drafts.sql', blob: '0cb9f6b8c495577d5c260da352428bfb849aad62' },
  { version: '20261012140000', filename: '20261012140000_reconcile_owner_deductions.sql', blob: 'cc65fbe4b81456996f87fc385125d560fbc23e9f' },
  { version: '20261012143000', filename: '20261012143000_finance_rls_and_tenant_links.sql', blob: '8d4005753a905edf822d0a9172cd61b033128047' },
  { version: '20261012150000', filename: '20261012150000_finance_approval_and_audit_timestamp_hardening.sql', blob: '44ca68e11894485ee160f673117b2d008c38c1d3' },
]);

// Already present in main: document, do not silently rename a historic migration.
export const KNOWN_DUPLICATE_VERSIONS = Object.freeze({
  '20261013040000': [
    '20261013040000_commission_recording_corrections.sql',
    '20261013040000_commission_safe_edit_and_paid_review.sql',
  ],
});

export function gitBlobSha(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash('sha1').update('blob ' + buffer.length + '\0').update(buffer).digest('hex');
}

export function verifyRepositoryFinanceHistory(migrationDir) {
  const problems = [];
  const sqlFiles = readdirSync(migrationDir).filter((file) => file.endsWith('.sql'));
  const versions = new Map();
  for (const file of sqlFiles) {
    const match = /^(\d{14})_[^.]+\.sql$/.exec(file);
    if (!match) continue;
    const group = versions.get(match[1]) ?? [];
    group.push(file);
    versions.set(match[1], group);
  }
  for (const [version, names] of versions) {
    if (names.length < 2) continue;
    const accepted = KNOWN_DUPLICATE_VERSIONS[version];
    if (!accepted || JSON.stringify([...names].sort()) !== JSON.stringify([...accepted].sort())) {
      problems.push('Duplicate migration version ' + version + ': ' + names.join(', '));
    }
  }
  for (const migration of REVIEWED_FINANCE_MIGRATIONS) {
    const file = join(migrationDir, migration.filename);
    if (!existsSync(file)) {
      problems.push('Historic financial migration removed: ' + migration.filename);
      continue;
    }
    if (gitBlobSha(readFileSync(file)) !== migration.blob)
      problems.push('Historic financial migration changed: ' + migration.filename);
  }
  return { ok: problems.length === 0, problems, migrationCount: sqlFiles.length };
}

export function inspectAppliedFinanceVersions(appliedVersions) {
  if (!Array.isArray(appliedVersions)) throw Error('The ledger must be a JSON array of versions or {version} objects');
  const values = appliedVersions.map((item) => typeof item === 'string' ? item : item?.version);
  if (values.some((version) => !/^\d{14}$/.test(version ?? '')))
    throw Error('Invalid migration ledger version (expected 14 digits)');
  const applied = new Set(values);
  const missing = REVIEWED_FINANCE_MIGRATIONS.filter((item) => !applied.has(item.version)).map((item) => item.version);
  return {
    safeToPush: missing.length === 0,
    missing,
    consolidatedPresent: ['20261012070133','20261012071309'].every((version) => applied.has(version)),
  };
}

function main(argv) {
  const migrationDir = resolve('supabase/migrations');
  const files = verifyRepositoryFinanceHistory(migrationDir);
  for (const issue of files.problems) console.error('MIGRATION HISTORY ERROR: ' + issue);
  if (!files.ok) return 1;
  console.log('Historic financial SQL unchanged; existing duplicate version is explicitly catalogued.');
  const ix = argv.indexOf('--ledger');
  if (ix === -1) {
    console.log('Repository-only check passed. Production db push NOT authorized without --ledger and schema verification.');
    return 0;
  }
  if (!argv[ix + 1]) throw Error('--ledger requires an explicit JSON file of applied production versions');
  const result = inspectAppliedFinanceVersions(JSON.parse(readFileSync(resolve(argv[ix + 1]), 'utf8')));
  if (!result.safeToPush) {
    console.error('NO-GO: five historic finance files have different applied versions in Supabase: ' + result.missing.join(', '));
    console.error('Do not run db push. Compare live DDL and reconcile officially under issue #104 first.');
    return 2;
  }
  console.log('Ledger versions found. This alone does NOT prove live DDL equivalence, RLS or authorization to deploy.');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
