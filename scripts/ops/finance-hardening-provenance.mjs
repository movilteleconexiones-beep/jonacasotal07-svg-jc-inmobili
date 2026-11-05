// INMOJCO #104: read-only provenance check for the second applied finance migration.
// The pinned digest comes from PostgreSQL 17 production migration metadata on 2026-11-05:
// SELECT encode(sha256(convert_to(statements[1], 'UTF8')), 'hex')
// FROM supabase_migrations.schema_migrations WHERE version='20261012071309';
// This verifies the original SQL body, not live schema equivalence or release readiness.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARDENING_SOURCE = Object.freeze({
  localFile: 'supabase/migrations/20261012150000_finance_approval_and_audit_timestamp_hardening.sql',
  appliedVersion: '20261012071309',
  appliedName: 'finance_approval_and_audit_timestamp_hardening',
  sha256: '4eab5a0e05dd5a4b5b6ad5bbf13bb9191e47f319bad8aa12ffd97afd8f1012c4',
  sourceBytes: 889,
  sourceLines: 24,
});

// Remove ONLY complete SQL comment lines and empty lines. Never change the
// remaining SQL or normalize its indentation, quoting, tokens, or whitespace.
export function stripDocumentationOnly(source) {
  if (typeof source !== 'string') throw new TypeError('SQL source must be a string');
  return source.replace(/\r\n/g, '\n').split('\n')
    .filter((line) => line.trim() !== '' && !/^\s*--/.test(line))
    .map((line) => line.trimEnd()).join('\n');
}

export function verifyAppliedHardeningSource(source) {
  const normalized = stripDocumentationOnly(source);
  const bytes = Buffer.byteLength(normalized, 'utf8');
  const sha256 = createHash('sha256').update(normalized, 'utf8').digest('hex');
  const lines = normalized.split('\n').length;
  return {
    matchesRecordedSql: bytes === HARDENING_SOURCE.sourceBytes &&
      lines === HARDENING_SOURCE.sourceLines &&
      sha256 === HARDENING_SOURCE.sha256,
    bytes, lines, sha256, appliedVersion: HARDENING_SOURCE.appliedVersion,
    releaseAllowed: false,
  };
}

// First applied consolidated finance migration: the four local SQL files have
// exactly the same executable DDL lines in order. The registered transaction
// envelope also includes two SET LOCAL statements and one NOTIFY, absent from
// the four individually wrapped local files. Keep those explicit, never infer.
export const FINANCE_CONSOLIDATION = Object.freeze({
  appliedVersion: '20261012070133',
  appliedName: 'audited_rent_receipts_owner_deductions_finance_permissions',
  localFiles: Object.freeze([
    '20261012120000_owner_statement_deduction_lines.sql',
    '20261012130000_rent_receipts_and_owner_drafts.sql',
    '20261012140000_reconcile_owner_deductions.sql',
    '20261012143000_finance_rls_and_tenant_links.sql',
  ]),
  normalizedSha256: '6953822bed1cd6b52a84afa5a2f97c7a2fa7dc5b28f34efbce51daf0c597d5b9',
  sourceBytes: 24924,
  sourceLines: 484,
});

export function reconstructAppliedConsolidation(sources) {
  if (!Array.isArray(sources) || sources.length !== FINANCE_CONSOLIDATION.localFiles.length)
    throw new TypeError('Exactly four SQL sources in historic order are required');
  const bodyLines = sources.flatMap((sql) => {
    const lines = stripDocumentationOnly(sql).split('\n');
    if (lines.length < 3 || lines[0] !== 'BEGIN;' || lines.at(-1) !== 'COMMIT;')
      throw new Error('Historic SQL transaction boundary changed');
    return lines.slice(1,-1);
  });
  return [
    'BEGIN;',
    "SET LOCAL lock_timeout='5s';",
    "SET LOCAL statement_timeout='120s';",
    ...bodyLines,
    "NOTIFY pgrst, 'reload schema';",
    'COMMIT;',
  ].join('\n');
}

export function verifyAppliedConsolidation(sources) {
  const sql = reconstructAppliedConsolidation(sources);
  const bytes = Buffer.byteLength(sql,'utf8');
  const lines = sql.split('\n').length;
  const sha256 = createHash('sha256').update(sql,'utf8').digest('hex');
  return {
    matchesRecordedSql: bytes===FINANCE_CONSOLIDATION.sourceBytes &&
      lines===FINANCE_CONSOLIDATION.sourceLines &&
      sha256===FINANCE_CONSOLIDATION.normalizedSha256,
    bytes, lines, sha256, appliedVersion: FINANCE_CONSOLIDATION.appliedVersion,
    releaseAllowed: false,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const source = readFileSync(resolve(HARDENING_SOURCE.localFile), 'utf8');
  const report = verifyAppliedHardeningSource(source);
  const consolidation = verifyAppliedConsolidation(FINANCE_CONSOLIDATION.localFiles.map((file) =>
    readFileSync(resolve('supabase/migrations',file),'utf8')));
  console.log(JSON.stringify({ hardening: report, consolidation }, null, 2));
  if (!report.matchesRecordedSql || !consolidation.matchesRecordedSql) {
    console.error('DRIFT: historic finance SQL differs from applied production history');
    process.exitCode = 1;
  } else {
    console.log('BOTH SOURCE BODIES MATCH; migration repair and db push remain NO-GO (#104).');
  }
}
