import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMigrationLineage } from '../scripts/ops/migration-lineage-audit.mjs';

const valid = [{ version: '20261012070133', name: 'safe_migration' }];

test('lineage audit rejects numeric versions instead of coercing them', () => {
  assert.throws(() => buildMigrationLineage(['20261012070133_safe_migration.sql'], [
    { version: 20261012070133, name: 'safe_migration' },
  ]), /Invalid applied migration/);
});

test('lineage audit rejects non-string migration names', () => {
  assert.throws(() => buildMigrationLineage([], [
    { version: '20261012070133', name: 123 },
  ]), /Invalid applied migration/);
});

test('lineage audit rejects non-string local filenames', () => {
  assert.throws(() => buildMigrationLineage([null, '20261012070133_safe_migration.sql'], valid),
    /Invalid local migration filename type/);
});

test('valid migration metadata remains read-only and cannot authorize push', () => {
  const result = buildMigrationLineage(['20261012070133_safe_migration.sql'], valid);
  assert.equal(result.summary['exact-version-and-name'], 1);
  assert.equal(result.sql_equivalence_verified, false);
  assert.equal(result.migration_push_authorized, false);
});

test('case-variant SQL suffix cannot silently disappear from migration reconciliation', () => {
  for (const filename of ['20261012070133_safe_migration.SQL', '20261012070133_safe_migration.Sql']) {
    assert.throws(() => buildMigrationLineage([filename], valid), /Unexpected migration SQL extension case/);
  }
  const result = buildMigrationLineage(['README.md', '20261012070133_safe_migration.sql'], valid);
  assert.equal(result.summary.local_files, 1);
  assert.equal(result.migration_push_authorized, false);
});

test('SQL suffix with trailing whitespace cannot silently disappear from reconciliation', () => {
  for (const filename of [
    '20261012070133_safe_migration.sql ',
    '20261012070133_safe_migration.SQL\t',
    '20261012070133_safe_migration.sql\n',
  ]) {
    assert.throws(() => buildMigrationLineage([filename], valid), /Unexpected migration SQL extension case/);
  }
});
