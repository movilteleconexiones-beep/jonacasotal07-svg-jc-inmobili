import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { deriveBackupKey, openEncryptedBuffer, sealBuffer } from
  '../scripts/lib/inmojco-encrypted-backup.mjs';

// This drill ONLY uses the two disposable databases set up by GitHub CI.
// Neither contains a real agency, property, customer, or Supabase secret.
const SOURCE = 'jco_backup_drill_source';
const TARGET = 'jco_backup_drill_restored';
const PGHOST = 'localhost';
const PGUSER = 'postgres';
const env = { ...process.env, PGPASSWORD: 'postgres' };
const sandbox = await mkdtemp(join(tmpdir(), 'inmojco-restore-drill-'));
after(async () => rm(sandbox, { recursive: true, force: true }));

function runPg(program, args, input) {
  return spawnSync(program, args, { env, input, maxBuffer: 12 * 1024 * 1024,
    encoding: input === undefined ? undefined : undefined });
}
function query(database, sql) {
  const response=runPg('psql', ['--no-password','--host='+PGHOST,
    '--username='+PGUSER,'--dbname='+database,'--tuples-only','--no-align',
    '--set=ON_ERROR_STOP=1','--command='+sql]);
  assert.equal(response.status,0,programError('psql', response));
  return response.stdout.toString('utf8').trim();
}
function programError(program, result) {
  return program + ' failed for local fixture; exit=' + result.status;
}

test('encrypted PostgreSQL 17 dump restores tables, data, FKs and RLS into a distinct disposable database', async () => {
  assert.notEqual(SOURCE,TARGET);
  // Original database is READ-ONLY to this test. It is populated exclusively
  // in the test CI workflow and not accessed via any user credentials.
  const sourceData=query(SOURCE,
    "SELECT string_agg(doc_ref || ':' || amount::text, ',' ORDER BY doc_ref) FROM fixture_documents");
  assert.equal(sourceData, 'DOC-A:1300000,DOC-B:1700000');

  const dump=runPg('pg_dump',['--format=custom','--no-password',
    '--host='+PGHOST,'--username='+PGUSER,'--dbname='+SOURCE]);
  assert.equal(dump.status,0,programError('pg_dump',dump));
  assert.equal(dump.stdout.subarray(0,5).toString('utf8'),'PGDMP');
  const password = 'CI-ONLY-ENCRYPTION-PASSPHRASE-NEVER-FOR-PRODUCTION';
  const salt = randomBytes(16).toString('hex');
  const key = deriveBackupKey(password,salt);
  const encrypted=join(sandbox,'postgres-dump.enc');
  const seal=await sealBuffer(dump.stdout,encrypted,key);
  assert.equal(seal.bytes,dump.stdout.length);
  assert.notEqual((await readFile(encrypted)).subarray(0,5).toString('utf8'),'PGDMP');
  const recovered = await openEncryptedBuffer(encrypted,key,seal);
  assert.deepEqual(recovered,dump.stdout);

  const restored=runPg('pg_restore',[
    '--no-owner','--no-privileges','--exit-on-error','--single-transaction',
    '--host='+PGHOST,'--username='+PGUSER,'--dbname='+TARGET
  ],recovered);
  assert.equal(restored.status,0,programError('pg_restore',restored));

  assert.equal(query(TARGET,
    "SELECT string_agg(doc_ref || ':' || amount::text, ',' ORDER BY doc_ref) FROM fixture_documents"),
    sourceData);
  assert.equal(query(TARGET, "SELECT count(*) FROM fixture_organizations"),'2');
  assert.equal(query(TARGET,
    "SELECT count(*) FROM pg_constraint WHERE conname='fixture_documents_organization_id_fkey' AND contype='f'"),'1');
  assert.equal(query(TARGET,
    "SELECT relrowsecurity::text FROM pg_class WHERE oid='public.fixture_documents'::regclass"),'true');
  assert.equal(query(TARGET,
    "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='fixture_documents'"),'1');
  assert.equal(query(TARGET,
    "SELECT count(*) FROM pg_indexes WHERE tablename='fixture_documents' AND indexname='fixture_documents_amount_idx'"),'1');

  // Verify source was not modified by the restore drill.
  assert.equal(query(SOURCE,
    "SELECT string_agg(doc_ref || ':' || amount::text, ',' ORDER BY doc_ref) FROM fixture_documents"),
    sourceData);
});

test('a corrupted encrypted database archive fails before touching any PostgreSQL target', async()=>{
  const key = deriveBackupKey('CI-ONLY-ENCRYPTION-PASSPHRASE-NEVER-FOR-PRODUCTION',
    randomBytes(16).toString('hex'));
  const path = join(sandbox,'corrupted.enc');
  const seal = await sealBuffer(Buffer.from('test-data'),path,key);
  const bytes = await readFile(path);
  bytes[0] ^= 0x80;
  await writeFile(path,bytes);
  await assert.rejects(()=>openEncryptedBuffer(path,key,seal), /Unable to decrypt backup manifest/);
});
