import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

import { FORMAT, deriveBackupKey, sealBuffer } from
  '../scripts/lib/inmojco-encrypted-backup.mjs';

// COMPLETE archive verification -> extraction -> pg_restore -> fictional
// Storage-byte comparison. Runs ONLY against the disposable PostgreSQL 17
// instance started by CI and NEVER against an external Supabase host.
const SOURCE = 'jco_backup_drill_source';
const TARGET = 'jco_backup_package_restored';
const PROJECT = 'cuitgyqrjibgwuniapmk'; // Format identifier, NEVER connected.
const PASSWORD = 'SYNTHETIC-E2E-BACKUP-PASSPHRASE-NO-REAL-SECRETS';
const ENV = {
  ...process.env,
  PGHOST: 'localhost',
  PGPORT: '5432',
  PGUSER: 'postgres',
  PGPASSWORD: 'postgres',
  PGSSLMODE: 'disable',
};
const root = await mkdtemp(join(tmpdir(), 'inmojco-package-restore-'));
let targetCreated = false;
after(async () => {
  if (targetCreated) {
    const dropped = runPg('psql', [
      '--dbname=postgres', '--command=DROP DATABASE ' + TARGET + ' WITH (FORCE)',
    ]);
    assert.equal(dropped.status, 0, 'Cannot clean disposable restore database');
  }
  await rm(root, { recursive: true, force: true });
});

function runPg(program, extra, input) {
  return spawnSync(program, [
    '--no-password', '--host=localhost', '--username=postgres',
    ...extra,
  ], { env: ENV, input, maxBuffer: 16 * 1024 * 1024 });
}

function query(db, expression) {
  const run = runPg('psql', [
    '--dbname=' + db, '--tuples-only', '--no-align',
    '--set=ON_ERROR_STOP=1', '--command=' + expression,
  ]);
  assert.equal(run.status, 0, 'Synthetic SQL query failed');
  return run.stdout.toString('utf8').trim();
}

function runCli(command, archive, extraction) {
  return spawnSync(process.execPath, [
    resolve('scripts/inmojco-backup.mjs'), command,
  ], {
    env: {
      ...ENV,
      INMOJCO_BACKUP_ARCHIVE: archive,
      INMOJCO_BACKUP_PASSPHRASE: PASSWORD,
      ...(extraction ? { INMOJCO_EXTRACT_DIR: extraction } : {}),
    },
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('real PG17 dump and two private documents survive authenticated package, CLI and isolated restore', async () => {
  assert.notEqual(SOURCE, TARGET);
  assert.equal(ENV.PGHOST, 'localhost');
  assert.equal(ENV.PGUSER, 'postgres');
  assert.equal(ENV.PGSSLMODE, 'disable');
  assert.equal(query('postgres',
    "SELECT count(*) FROM pg_database WHERE datname='" + TARGET + "'"), '0',
    'Never overwrite a database, even in an isolated CI instance');
  const expectedLedger = query(SOURCE,
    "SELECT string_agg(doc_ref || ':' || amount::text, ',' ORDER BY doc_ref) FROM fixture_documents");
  assert.equal(expectedLedger, 'DOC-A:1300000,DOC-B:1700000');

  const dump = runPg('pg_dump', ['--dbname=' + SOURCE, '--format=custom']);
  assert.equal(dump.status, 0, 'Synthetic PostgreSQL 17 pg_dump failed');
  assert.equal(dump.stdout.subarray(0, 5).toString(), 'PGDMP');

  const archive = join(root, 'ciphertext');
  const extraction = join(root, 'plaintext');
  await mkdir(archive, { mode: 0o700 });
  await mkdir(join(archive, 'objects'), { mode: 0o700 });
  const salt = randomBytes(16).toString('hex');
  const key = deriveBackupKey(PASSWORD, salt);
  const dbSeal = await sealBuffer(dump.stdout, join(archive, 'database.enc'), key);
  const documents = [
    {
      bucket: 'organization-documents',
      path: 'contracts/fictitious-lease-A.pdf',
      contents: Buffer.from('%PDF-1.4\nsynthetic signed contract A\n%%EOF\n'),
      file: 'objects/000001.enc',
    },
    {
      bucket: 'jco-inventory-private',
      path: 'properties/fixture-photo-B.png',
      contents: Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0xff,0x01]),
      file: 'objects/000002.enc',
    },
  ];
  const entries = [];
  for (const d of documents) {
    const seal = await sealBuffer(d.contents, join(archive,d.file), key);
    entries.push({ bucket:d.bucket, path:d.path, file:d.file, seal });
  }
  const manifest = {
    format: FORMAT, project: PROJECT,
    createdAt:'2026-11-04T00:00:00.000Z',
    database:{file:'database.enc',seal:dbSeal},
    buckets:[
      { id:'organization-documents', public:false },
      { id:'jco-inventory-private', public:false },
    ],
    objects:entries,
    // Fictional coverage allows checking a well-formed manifest. It does
    // not assert coverage of any live Supabase Storage bucket.
    storageCoverage:{objects:2,buckets:2,fingerprint:sha256(Buffer.from('fictional inventory'))},
  };
  const manifestSeal = await sealBuffer(Buffer.from(JSON.stringify(manifest)),
    join(archive,'manifest.enc'), key);
  await writeFile(join(archive,'backup-meta.json'), JSON.stringify({
    format:FORMAT, project:PROJECT, salt, manifestSeal,
  }), {flag:'wx',mode:0o600});

  assert.notEqual((await readFile(join(archive,'database.enc')))
    .subarray(0,5).toString(),'PGDMP');
  const inspect = runCli('inspect', archive);
  assert.equal(inspect.status, 0, 'Real PG17 custom-format archive must be inspectable');

  // Even valid manifests cannot bless damaged ciphertext. A failed
  // extraction must not leave a partially decrypted destination.
  const encryptedPhoto = join(archive, documents[1].file);
  const originalCiphertext = await readFile(encryptedPhoto);
  const damaged = Buffer.from(originalCiphertext);
  damaged[0] ^= 0x80;
  await writeFile(encryptedPhoto, damaged);
  const broken = runCli('extract', archive, extraction);
  assert.notEqual(broken.status, 0, 'Tampered Storage object unexpectedly accepted');
  await assert.rejects(() => readFile(join(extraction,'restore-map.json')),
    {code:'ENOENT'});
  await assert.rejects(() => readFile(join(extraction,'database.dump')),
    {code:'ENOENT'});
  await writeFile(encryptedPhoto, originalCiphertext);

  const verify = runCli('verify', archive);
  assert.equal(verify.status, 0, 'Authenticated package verification failed');
  assert.match(verify.stdout,/metadataCoverageRecorded:\s*true/);
  const extract = runCli('extract', archive, extraction);
  assert.equal(extract.status, 0, 'Authenticated package extraction failed');
  assert.deepEqual(await readFile(join(extraction,'database.dump')), dump.stdout);
  const map = JSON.parse(await readFile(join(extraction,'restore-map.json'),'utf8'));
  assert.equal(map.project, PROJECT);
  assert.equal(map.objects.length, documents.length);
  for (let index = 0; index < documents.length; index++) {
    const expected = documents[index];
    const mapped = map.objects[index];
    assert.equal(mapped.bucket, expected.bucket);
    assert.equal(mapped.path, expected.path);
    const restoredBytes = await readFile(join(extraction, mapped.file));
    assert.equal(sha256(restoredBytes), sha256(expected.contents));
    assert.deepEqual(restoredBytes, expected.contents);
  }

  const created = runPg('psql', [
    '--dbname=postgres', '--set=ON_ERROR_STOP=1',
    '--command=CREATE DATABASE ' + TARGET,
  ]);
  assert.equal(created.status,0,'Cannot create local test database');
  targetCreated = true;
  const restored = runPg('pg_restore', [
    '--dbname=' + TARGET,
    '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error',
  ], await readFile(join(extraction,'database.dump')));
  assert.equal(restored.status, 0, 'Isolated PostgreSQL 17 restore failed');
  assert.equal(query(TARGET,
    "SELECT string_agg(doc_ref || ':' || amount::text, ',' ORDER BY doc_ref) FROM fixture_documents"),
    expectedLedger);
  assert.equal(query(TARGET,
    "SELECT count(*) FROM pg_constraint WHERE conname='fixture_documents_organization_id_fkey'"), '1');
  assert.equal(query(TARGET,
    "SELECT relrowsecurity::text FROM pg_class WHERE oid='public.fixture_documents'::regclass"),'true');
  assert.equal(query(TARGET,
    "SELECT count(*) FROM pg_policy WHERE polrelid='public.fixture_documents'::regclass"),'1');
  assert.equal(query(TARGET,
    "SELECT count(*) FROM pg_indexes WHERE tablename='fixture_documents' AND indexname='fixture_documents_amount_idx'"),'1');
  assert.equal(query(SOURCE,
    "SELECT string_agg(doc_ref || ':' || amount::text, ',' ORDER BY doc_ref) FROM fixture_documents"),
    expectedLedger, 'Source changed during isolated restore');
});
