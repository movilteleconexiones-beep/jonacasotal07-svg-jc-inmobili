// INMOJCO #104 - offline migration VERSION reconciliation, not a repair plan.
// Safe-to-repair and safe-to-push are deliberately NEVER inferred from SQL provenance.
// Reads only repository files; no CLI credentials, database connection or SQL execution.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlobSha } from './finance-migration-gate.mjs';
import { verifyPinnedMigrationSources } from './migration-source-parity-gate.mjs';
import {historicalInventory,historicSqlFile} from './historic-sql-source.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const migrationDir = resolve(root, 'supabase/migrations');
const originalManifest = 'docs/ops/snapshots/migration-source-parity-2026-11-06.json';
const originalLedger = 'docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json';

// Provenance of exactly three timestamped files is NOT certified by the 99 applied
// SQL bodies. They must not be silently stamped 'applied' or replayed in production.
export const UNMATCHED_CANDIDATES = Object.freeze({
  '20261010212630_property_consignment_intake.sql': 'e4b252f022cf76f5ad773060ff86d33c29ef564c',
  '20261010214633_fix_property_portal_rls_recursion.sql': 'e6cb9a3923328158a42c86644fb4a591df25eba9',
  '20261010222700_commercial_plan_permissions.sql': '463d7c438f30406b576caf2a7cbbc50e2147d4e6',
});

export function reconcileVersions({ manifest, ledger, filenames, fingerprint = null }) {
  const errors = [];
  if (!manifest || !Array.isArray(manifest.records) ||
      !ledger || !Array.isArray(ledger.migrations) || !Array.isArray(filenames)) {
    return { ok: false, safeToPush: false, safeToRepair: false,
      errors: ['Required repository snapshots or migration list are missing'] };
  }
  const applied = new Set(ledger.migrations.map(r => r.version));
  const sources = new Map();
  for (const record of manifest.records) {
    const recordedPaths = [record.localPath, ...(record.localSources ?? [])].filter(Boolean);
    for (const source of recordedPaths) {
      if (!source.startsWith('supabase/migrations/')) continue;
      const name = source.slice('supabase/migrations/'.length);
      const matches = sources.get(name) || [];
      matches.push(record.version);
      sources.set(name, matches);
    }
  }
  const sql = [...filenames].filter(f => f.endsWith('.sql'));
  const timestamped = sql.filter(f => /^\d{14}_[^.]+\.sql$/.test(f));
  const legacy = sql.filter(f => /^\d{4}_[^.]+\.sql$/.test(f));
  const unclassified = sql.filter(f => !timestamped.includes(f) && !legacy.includes(f));
  const localVersions = new Set(timestamped.map(f => f.slice(0, 14)));
  const matchedVersion = timestamped.filter(f => applied.has(f.slice(0,14)));
  const missing = timestamped.filter(f => !applied.has(f.slice(0,14)));
  const traced = missing.filter(f => sources.has(f)).map(f => ({
    file: f, evidencedByAppliedVersions: sources.get(f).slice().sort(),
    status: 'SOURCE_TRACED_VERSION_UNMATCHED',
  }));
  const unknown = missing.filter(f => !sources.has(f)).map(f => ({
    file: f, status: 'UNPROVEN_NOT_SAFE_TO_REPAIR_OR_REPLAY',
  }));
  if (sql.length !== 109 || timestamped.length !== 77 || legacy.length !== 32 ||
      localVersions.size !== 76 || matchedVersion.length !== 1 ||
      missing.length !== 76 || traced.length !== 73 || unknown.length !== 3 ||
      ledger.migrations.length !== 99 || manifest.records.length !== 99) {
    errors.push('Migration inventory diverges from verified 99/109 history; re-audit first');
  }
  if (unclassified.length) errors.push('Unclassified SQL migration files: ' + unclassified.join(', '));
  if (new Set(sql).size !== sql.length) errors.push('Duplicate migration filename');
  if (JSON.stringify(unknown.map(x => x.file).sort()) !==
      JSON.stringify(Object.keys(UNMATCHED_CANDIDATES).sort())) {
    errors.push('Unexpected unmatched migration candidate');
  }
  for (const file of Object.keys(UNMATCHED_CANDIDATES)) {
    if (typeof fingerprint !== 'function') continue;
    try {
      if (fingerprint(file) !== UNMATCHED_CANDIDATES[file])
        errors.push('Unmatched candidate changed: ' + file);
    } catch {
      errors.push('Unmatched candidate unreadable: ' + file);
    }
  }
  return {
    ok: errors.length === 0,
    safeToPush: false,
    safeToRepair: false,
    observed: { applied: applied.size, sqlFiles: sql.length, timestampedFiles: timestamped.length,
      timestampedVersions: localVersions.size, legacyFiles: legacy.length,
      matchedVersionFiles: matchedVersion.length, missingVersionFiles: missing.length,
      tracedMissingFiles: traced.length, unmatchedMissingFiles: unknown.length },
    matchedVersion: matchedVersion.map(f => f.slice(0,14)),
    unknown, traced, errors,
    warning: 'Historical SQL source equality does not certify physical schema replay, current prices or permission grants.',
  };
}

export function verifyCurrentVersionInventory() {
  // Additional source-parity gate pins actual SQL bodies and the genuine 99-row
  // historical ledger. These two independent checks MUST both pass.
  const provenance = verifyPinnedMigrationSources();
  const manifest = JSON.parse(readFileSync(resolve(root, originalManifest), 'utf8'));
  const ledger = JSON.parse(readFileSync(resolve(root, originalLedger), 'utf8'));
  // Legacy mismatch analysis must reference the preserved 109 original files,
  // not the new 99-file canonical deployment directory.
  const filenames = historicalInventory(root);
  const versionPlan = reconcileVersions({
    manifest, ledger, filenames,
    fingerprint(file) { return gitBlobSha(readFileSync(historicSqlFile(root,file))); },
  });
  if (!provenance.ok) versionPlan.errors.push('Pinned production SQL source parity failed');
  versionPlan.ok = versionPlan.errors.length === 0;
  return versionPlan;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyCurrentVersionInventory();
  // Output is metadata ONLY: no passwords, PII, SQL, or executable repair commands.
  console.log(JSON.stringify({
    ok: result.ok, safeToPush: false, safeToRepair: false,
    observed: result.observed, unknown: result.unknown,
    errors: result.errors, warning: result.warning,
  }, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
