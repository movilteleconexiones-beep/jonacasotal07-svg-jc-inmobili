import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyBackupIntegrity } from '../scripts/recovery/verify-backup-integrity.mjs';

const hash = input => createHash('sha256').update(input).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'inmojco-backup-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'storage', 'jco-inventory-private', 'org'), { recursive: true });
  await writeFile(join(root, 'postgres.dump.enc'), 'fictitious encrypted postgres dump');
  await writeFile(join(root, 'storage', 'jco-inventory-private', 'org', 'photo.jpg'), 'fake photo');
  const manifest = {
    version: 1,
    project_ref: 'cuitgyqrjibgwuniapmk',
    created_at_utc: '2026-10-27T17:45:00Z',
    database: { file: 'postgres.dump.enc', sha256: hash('fictitious encrypted postgres dump') },
    buckets: [{ id: 'jco-inventory-private', object_count: 1 }],
    objects: [{ bucket: 'jco-inventory-private', path: 'org/photo.jpg', sha256: hash('fake photo') }],
  };
  const path = join(root, 'manifest.json');
  async function save() { await writeFile(path, JSON.stringify(manifest)); }
  await save();
  return { root, path, manifest, save };
}

test('accepts only matching database and Storage bytes', async t => {
  const f = await fixture(t);
  assert.deepEqual(await verifyBackupIntegrity(f.path, f.root), { objects_verified: 1, buckets_verified: 1, db_verified: true });
});

test('rejects tampered database dump', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'postgres.dump.enc'), 'tampered');
  await assert.rejects(verifyBackupIntegrity(f.path, f.root), /PostgreSQL no coincide/);
});

test('rejects tampered Storage bytes', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'storage', 'jco-inventory-private', 'org', 'photo.jpg'), 'tampered');
  await assert.rejects(verifyBackupIntegrity(f.path, f.root), /Storage no coincide/);
});

test('rejects directory traversal in manifests', async t => {
  const f = await fixture(t);
  f.manifest.database.file = '../secret.dump';
  await f.save();
  await assert.rejects(verifyBackupIntegrity(f.path, f.root), /Ruta relativa no válida/);
});

test('rejects symlinked database dump', async t => {
  const f = await fixture(t);
  await symlink(join(f.root, 'postgres.dump.enc'), join(f.root, 'linked.dump'));
  f.manifest.database.file = 'linked.dump';
  await f.save();
  await assert.rejects(verifyBackupIntegrity(f.path, f.root), /archivos regulares/);
});

test('rejects duplicate and absent object entries', async t => {
  const f = await fixture(t);
  f.manifest.objects.push({ ...f.manifest.objects[0] });
  await f.save();
  await assert.rejects(verifyBackupIntegrity(f.path, f.root), /repetido/);
  f.manifest.objects.pop();
  f.manifest.buckets[0].object_count = 2;
  await f.save();
  await assert.rejects(verifyBackupIntegrity(f.path, f.root), /Conteo/);
});

test('rejects incorrect source project and invalid hash format', async t => {
  const f = await fixture(t);
  f.manifest.project_ref = 'not-production';
  await f.save();
  await assert.rejects(verifyBackupIntegrity(f.path, f.root), /no válido/);
  f.manifest.project_ref = 'cuitgyqrjibgwuniapmk';
  f.manifest.database.sha256 = 'wrong';
  await f.save();
  await assert.rejects(verifyBackupIntegrity(f.path, f.root), /SHA-256 inválida/);
});
