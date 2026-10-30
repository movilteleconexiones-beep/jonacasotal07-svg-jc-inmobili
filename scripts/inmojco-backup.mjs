#!/usr/bin/env node
/**
 * Opt-in OFFLINE export. No secrets or user documents ever enter GitHub.
 *
 * backup: pg_dump of all accessible PostgreSQL schemas + private Storage bytes
 *         into authenticated, encrypted local files.
 * verify: decrypt every encrypted object to a discard sink; verify SHA-256.
 * extract: decrypt to a NEW private folder for isolated restore review ONLY.
 *
 * Backups are NOT transactionally synchronized across DB + Storage.
 * NEVER run pg_restore against the live production project.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createClient } from '@supabase/supabase-js';
import { FORMAT, deriveBackupKey, sealStream, sealBuffer, openEncrypted,
  openEncryptedBuffer } from './lib/inmojco-encrypted-backup.mjs';

const PROJECT = 'cuitgyqrjibgwuniapmk';
const PROJECT_URL = 'https://' + PROJECT + '.supabase.co';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function mustHave(name) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error('Missing required local environment variable: ' + name);
  return value;
}

function localPath(name) {
  const input = mustHave(name);
  if (!isAbsolute(input)) throw new Error(name + ' must be an absolute path outside the Git repository');
  return resolve(input);
}

function outsideRepository(path) {
  const rel = relative(projectRoot, path);
  if (!rel || (rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\')))
    throw new Error('Refusing to put private backup files inside the source repository');
}

export async function listStorageObjects(storage, bucket, prefix = '', seen = new Set()) {
  const result = [];
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const { data, error } = await storage.from(bucket).list(prefix,
      { limit, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error || !Array.isArray(data)) throw new Error('Unable to enumerate private Storage objects');
    for (const entry of data) {
      if (!entry || typeof entry.name !== 'string' || entry.name === '.'
        || entry.name === '..' || entry.name.includes('/')) throw new Error('Unexpected Storage entry');
      const key = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.id == null) {
        result.push(...await listStorageObjects(storage, bucket, key, seen));
      } else {
        if (seen.has(key)) throw new Error('Duplicate Storage object during enumeration');
        seen.add(key);
        result.push(key);
      }
    }
    if (data.length < limit) return result;
  }
}

async function encryptedDump(destination, key) {
  for (const name of ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'])
    mustHave(name);
  // Fail closed if the operator accidentally points to the legacy database.
  const host = process.env.PGHOST.toLowerCase();
  const user = process.env.PGUSER.toLowerCase();
  if (!host.includes(PROJECT) && !user.includes(PROJECT))
    throw new Error('Database target does not identify the active INMOJCO Supabase project');
  const child = spawn('pg_dump', ['--format=custom', '--no-password'], {
    env: { ...process.env, PGSSLMODE: process.env.PGSSLMODE ?? 'require' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Do not print stderr: connection errors can contain sensitive connection details.
  child.stderr.resume();
  const exit = new Promise((done, reject) => {
    child.once('error', () => reject(new Error('Cannot start pg_dump')));
    child.once('close', (code) => code === 0 ? done() : reject(new Error('pg_dump failed')));
  });
  const [seal] = await Promise.all([sealStream(child.stdout, destination, key), exit]);
  if (seal.bytes < 1) throw new Error('Empty database dump');
  return seal;
}

async function readAndVerify(archive, passphrase, extractRoot) {
  const meta = JSON.parse(await readFile(join(archive, 'backup-meta.json'), 'utf8'));
  if (meta.format !== FORMAT || meta.project !== PROJECT)
    throw new Error('Unrecognized backup project or format');
  const key = deriveBackupKey(passphrase, meta.salt);
  const manifest = JSON.parse((await openEncryptedBuffer(
    join(archive, 'manifest.enc'), key, meta.manifestSeal)).toString('utf8'));
  if (manifest.format !== FORMAT || manifest.project !== PROJECT
    || manifest.database?.file !== 'database.enc' || !Array.isArray(manifest.objects)
    || !Array.isArray(manifest.buckets)) throw new Error('Invalid encrypted manifest');
  const files = new Set();
  let createdExtraction = false;
  try {
  if (extractRoot) {
    outsideRepository(extractRoot);
    await mkdir(extractRoot, { mode: 0o700 }); // Must not exist.
    createdExtraction = true;
    await mkdir(join(extractRoot, 'objects'), { mode: 0o700 });
  }
  await openEncrypted(join(archive, 'database.enc'), key, manifest.database.seal,
    extractRoot ? join(extractRoot, 'database.dump') : undefined);
  for (const item of manifest.objects) {
    if (!/^objects\/[0-9]{6}\.enc$/.test(item.file) || files.has(item.file))
      throw new Error('Unexpected object filename in encrypted manifest');
    files.add(item.file);
    const destination = extractRoot
      ? join(extractRoot, 'objects', item.file.slice('objects/'.length).replace('.enc', '.bin'))
      : undefined;
    await openEncrypted(join(archive, item.file), key, item.seal, destination);
  }
  if (extractRoot) {
    // The map of numbered files to original bucket and object keys is sensitive.
    await writeFile(join(extractRoot, 'restore-map.json'),
      JSON.stringify({ project: PROJECT, buckets: manifest.buckets,
        objects: manifest.objects.map(x => ({ bucket: x.bucket, path: x.path,
          file: x.file.replace('.enc', '.bin') })) }, null, 2),
      { flag: 'wx', mode: 0o600 });
  }
  return { files: manifest.objects.length, buckets: manifest.buckets.length,
    databaseBytes: manifest.database.seal.bytes };
  } catch (error) {
    // Never leave partially decrypted contracts or SQL on disk on failed extract.
    // Only remove a folder that THIS invocation successfully created.
    if (createdExtraction) await rm(extractRoot, { recursive: true, force: true });
    throw error;
  }
}

async function backup() {
  const passphrase = mustHave('INMOJCO_BACKUP_PASSPHRASE');
  const root = await realpath(localPath('INMOJCO_BACKUP_DIR'));
  outsideRepository(root);
  const url = mustHave('SUPABASE_URL').replace(/\/$/, '');
  if (url !== PROJECT_URL) throw new Error('SUPABASE_URL is not the active INMOJCO project');
  const serviceKey = mustHave('SUPABASE_SERVICE_ROLE_KEY');
  const stamp = new Date().toISOString();
  const name = 'inmojco-' + stamp.replace(/[:.]/g, '-') + '-' + randomBytes(4).toString('hex');
  const archive = join(root, name);
  const salt = randomBytes(16).toString('hex');
  const key = deriveBackupKey(passphrase, salt);
  const client = createClient(PROJECT_URL, serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } });
  await mkdir(archive, { mode: 0o700 });
  try {
    await mkdir(join(archive, 'objects'), { mode: 0o700 });
    const { data: buckets, error: bucketsError } = await client.storage.listBuckets();
    if (bucketsError || !Array.isArray(buckets))
      throw new Error('Could not enumerate Supabase Storage buckets');
    const manifest = { format: FORMAT, project: PROJECT, createdAt: stamp,
      consistency: 'non-atomic-db-and-storage-export', buckets: [], objects: [],
      database: { file: 'database.enc', seal: await encryptedDump(join(archive,'database.enc'),key) } };
    for (const bucket of buckets) {
      if (!/^[A-Za-z0-9_.-]+$/.test(bucket.id))
        throw new Error('Unrecognized Storage bucket identifier');
      manifest.buckets.push({ id: bucket.id, public: Boolean(bucket.public) });
      const paths = await listStorageObjects(client.storage, bucket.id);
      for (const path of paths) {
        const { data, error } = await client.storage.from(bucket.id).download(path);
        if (error || !data) throw new Error('Private Storage download failed');
        if (data.size > 100 * 1024 * 1024) throw new Error('Storage file exceeds safe local memory limit');
        const filename = 'objects/' + String(manifest.objects.length + 1).padStart(6,'0') + '.enc';
        const bytes = Buffer.from(await data.arrayBuffer());
        const seal = await sealBuffer(bytes, join(archive,filename),key);
        manifest.objects.push({ bucket: bucket.id, path, file: filename, seal });
      }
    }
    const manifestSeal = await sealBuffer(Buffer.from(JSON.stringify(manifest)),
      join(archive, 'manifest.enc'), key);
    await writeFile(join(archive, 'backup-meta.json'),
      JSON.stringify({ format: FORMAT, project: PROJECT, salt, manifestSeal, createdAt: stamp }),
      { flag: 'wx', mode: 0o600 });
    const check = await readAndVerify(archive, passphrase);
    console.log('Encrypted local backup verified; database:',check.databaseBytes,
      'bytes; Storage objects:',check.files,'; buckets:',check.buckets);
    console.log('Private archive folder:',archive);
  } catch (error) {
    await rm(archive, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const command = process.argv[2];
  if (command === 'backup') await backup();
  else if (command === 'verify' || command === 'extract') {
    const archive = localPath('INMOJCO_BACKUP_ARCHIVE');
    outsideRepository(archive);
    const passphrase = mustHave('INMOJCO_BACKUP_PASSPHRASE');
    const target = command === 'extract' ? localPath('INMOJCO_EXTRACT_DIR') : undefined;
    const summary = await readAndVerify(archive, passphrase, target);
    console.log(command === 'extract' ? 'Decrypted to private folder for ISOLATED restore review.'
      : 'Cryptographic verification passed.',summary);
    if (target) console.log('DO NOT restore database.dump into live Supabase.');
  } else throw new Error('Usage: node scripts/inmojco-backup.mjs backup|verify|extract');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('Backup operation failed:', error.message); process.exitCode = 1; });
}
