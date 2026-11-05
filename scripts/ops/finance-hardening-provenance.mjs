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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const source = readFileSync(resolve(HARDENING_SOURCE.localFile), 'utf8');
  const report = verifyAppliedHardeningSource(source);
  console.log(JSON.stringify(report, null, 2));
  if (!report.matchesRecordedSql) {
    console.error('DRIFT: original hardening SQL differs from applied production history');
    process.exitCode = 1;
  } else {
    console.log('SOURCE MATCH; migration repair and db push remain NO-GO (#104).');
  }
}
