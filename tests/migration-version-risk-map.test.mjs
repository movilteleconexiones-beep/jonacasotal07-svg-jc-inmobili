import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { gitBlobSha } from '../scripts/ops/finance-migration-gate.mjs';
import { UNMATCHED_CANDIDATES, reconcileVersions, verifyCurrentVersionInventory,
} from '../scripts/ops/migration-version-risk-map.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('docs/ops/snapshots/migration-source-parity-2026-11-06.json'));
const ledger = JSON.parse(read('docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json'));
const filenames = readdirSync(new URL('../supabase/migrations/', import.meta.url));
const candidateHash = file => gitBlobSha(read('supabase/migrations/' + file));
const calculate = (options = {}) => reconcileVersions({
  manifest: options.manifest ?? manifest,
  ledger: options.ledger ?? ledger,
  filenames: options.filenames ?? filenames,
  fingerprint: options.fingerprint ?? candidateHash,
});

test('#104: 73 historically traced version mismatches and exactly 3 unproven SQL files', () => {
  const result = verifyCurrentVersionInventory();
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.safeToPush, false);
  assert.equal(result.safeToRepair, false);
  assert.deepEqual(result.observed, {
    applied: 99, sqlFiles: 109, timestampedFiles: 77, timestampedVersions: 76,
    legacyFiles: 32, matchedVersionFiles: 1, missingVersionFiles: 76,
    tracedMissingFiles: 73, unmatchedMissingFiles: 3,
  });
  assert.deepEqual(result.unknown.map(x => x.file).sort(), Object.keys(UNMATCHED_CANDIDATES).sort());
  assert.equal(result.traced.length, 73);
  for (const row of result.traced) {
    assert.ok(row.evidencedByAppliedVersions.every(v => /^\d{14}$/.test(v)));
    assert.equal(row.status, 'SOURCE_TRACED_VERSION_UNMATCHED');
  }
});

test('#104: commercial catalog candidate is NOT the live approved price list', () => {
  const file = read('supabase/migrations/20261010222700_commercial_plan_permissions.sql');
  assert.match(file, /price = 104900/);
  assert.match(file, /price = 194900/);
  assert.match(file, /BASIC_ANNUAL/);
  // Read-only Supabase catalog captured 2026-11-06:
  // BASIC=129900 COP, PRO=299900 COP, no *_ANNUAL codes.
  // This test documents why replay would alter actual approved commercial terms.
  const approved = { BASIC: 129900, PRO: 299900 };
  assert.notEqual(approved.BASIC, 104900);
  assert.notEqual(approved.PRO, 194900);
  assert.equal(calculate().safeToRepair, false);
});

test('#104: missing, renamed, newly-added, or tampered candidates are hard failures', () => {
  for (const broken of [
    { filenames: filenames.filter(f => f !== '20261010222700_commercial_plan_permissions.sql') },
    { filenames: [...filenames, '20261107000000_unreviewed_new_finance.sql'] },
    { filenames: [...filenames, '20261010222700_commercial_plan_permissions.sql'] },
    { fingerprint: file => file.includes('commercial_plan_permissions') ? '0'.repeat(40) : candidateHash(file) },
  ]) {
    const result = calculate(broken);
    assert.equal(result.ok, false);
    assert.equal(result.safeToPush, false);
    assert.equal(result.safeToRepair, false);
  }
});

test('#104: falsified applied ledger or fake historical source mapping never gives GO', () => {
  const revisedLedger = structuredClone(ledger);
  revisedLedger.migrations.push({ version: '20261010222700', name: 'false_repair' });
  assert.equal(calculate({ ledger: revisedLedger }).ok, false);

  const falsifiedManifest = structuredClone(manifest);
  falsifiedManifest.records[0].localPath =
    'supabase/migrations/20261010222700_commercial_plan_permissions.sql';
  assert.equal(calculate({ manifest: falsifiedManifest }).ok, false);

  const script = read('scripts/ops/migration-version-risk-map.mjs');
  assert.doesNotMatch(script, /\b(?:execute_sql|apply_migration|db push --|migration repair --)\b/);
  assert.match(script, /safeToRepair: false/);
  assert.match(script, /safeToPush: false/);
});
