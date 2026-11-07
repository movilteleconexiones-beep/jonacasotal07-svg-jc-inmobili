import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {outsideRepository, validateArchivePath, parseArchiveToc,
  checkCatalogOutput, CATALOG_CHECKS}
  from '../scripts/ops/backup104-restore-gate.mjs';

const toc = [
'; custom archive',
'13; 1259 123 TABLE auth users postgres',
'14; 0 123 TABLE DATA auth users postgres',
'15; 1259 124 TABLE storage objects postgres',
'16; 0 124 TABLE DATA storage objects postgres',
'17; 1259 125 TABLE supabase_migrations schema_migrations postgres',
'18; 0 125 TABLE DATA supabase_migrations schema_migrations postgres',
'19; 1259 126 TABLE public properties postgres',
'20; 0 126 TABLE DATA public properties postgres',
].join('\n');

test('#104: only archive with auth, storage, migration ledger and tenant data entries passes inventory', () => {
  const parsed = parseArchiveToc(toc);
  assert.equal(parsed.complete, true);
  assert.equal(parsed.checks.length, 4);
  assert.equal(parseArchiveToc(toc.replace('16; 0 124 TABLE DATA storage objects postgres', '')).complete, false);
  assert.equal(parseArchiveToc(toc.replace('17; 1259 125 TABLE supabase_migrations schema_migrations postgres', '')).complete, false);
  assert.equal(parseArchiveToc('; only comments and no table data').complete, false);
});

test('#104: catalog gate verifies every unique fingerprint identity, not just OK count', () => {
  assert.equal(CATALOG_CHECKS.consignment.length, 14);
  assert.equal(CATALOG_CHECKS.portalAndBilling.length, 10);
  for (const expected of Object.values(CATALOG_CHECKS)) {
    const rows = expected.map(pair => pair.join('|') + '|OK');
    assert.deepEqual(checkCatalogOutput(rows.join('\n'), expected),
      {total: expected.length, passing: expected.length, complete: true});
    // Output order is not semantically relevant.
    assert.equal(checkCatalogOutput([...rows].reverse().join('\n'), expected).complete, true);
    assert.equal(checkCatalogOutput(rows.slice(1).join('\n'), expected).complete, false);
    assert.equal(checkCatalogOutput([...rows, rows[0]].join('\n'), expected).complete, false);
    assert.equal(checkCatalogOutput([rows[0], ...rows.slice(0, -1)].join('\n'), expected).complete, false,
      'duplicate OK row must never hide the missing expected fingerprint');
    assert.equal(checkCatalogOutput([rows[0].replace('|OK', '|DRIFT'), ...rows.slice(1)].join('\n'), expected).complete, false);
    assert.equal(checkCatalogOutput(['extra|unrecognized|OK', ...rows.slice(1)].join('\n'), expected).complete, false);
    assert.equal(checkCatalogOutput([rows[0].replace('|OK', '|OK|OK'), ...rows.slice(1)].join('\n'), expected).complete, false);
    assert.equal(checkCatalogOutput(['OK|' + rows[0].slice(0, -3), ...rows.slice(1)].join('\n'), expected).complete, false);
    assert.equal(checkCatalogOutput(rows[0] + '\n', expected).complete, expected.length === 1);
  }
  assert.throws(() => checkCatalogOutput('anything|OK', 14), /explicitly named fingerprint pairs/);
  assert.throws(() => checkCatalogOutput('a|b|OK', [['a','b'],['a','b']]), /Duplicate expected fingerprint/);
});

test('#104: a private dump must never live inside public GitHub checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'jco-104-'));
  try {
    const repo = join(root, 'repo');
    const privateFile = join(root, 'offrepo.dump');
    writeFileSync(privateFile, 'test');
    assert.equal(outsideRepository(privateFile, repo), true);
    assert.equal(outsideRepository(resolve(repo, 'backup.dump'), repo), false);
    assert.equal(validateArchivePath(privateFile, repo).size, 4);
    assert.throws(() => validateArchivePath(resolve(repo, 'backup.dump'), repo));
    assert.throws(() => validateArchivePath('relative.dump', repo));
  } finally {rmSync(root, {recursive:true, force:true});}
});
