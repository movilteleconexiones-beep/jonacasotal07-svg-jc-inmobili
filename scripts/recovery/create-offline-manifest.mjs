#!/usr/bin/env node
// Offline-only: describe bytes already exported to a PRIVATE directory.
// No Supabase connection, no downloads, no credentials, no restoration.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROJECT_REF = 'cuitgyqrjibgwuniapmk';
export const REQUIRED_BUCKETS = [
  'jco-consignment-photos', 'jco-inventory-private',
  'jco-rent-receipts-private', 'organization-documents',
];

const safeName = (name) => typeof name === 'string' && name !== '' &&
  !name.includes('\\') && !name.includes('\0') &&
  !isAbsolute(name) && name.split('/').every(segment =>
    segment !== '' && segment !== '.' && segment !== '..' && !segment.includes(':'));

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function normalFile(root, rel) {
  if (!safeName(rel)) throw new Error('Ruta de archivo inválida.');
  const path = resolve(root, ...rel.split('/'));
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Archivo no regular o enlace simbólico.');
  const canonical = await realpath(path);
  const r = relative(root, canonical);
  if (r === '..' || r.startsWith('..' + sep) || isAbsolute(r))
    throw new Error('Archivo fuera del directorio privado.');
  return canonical;
}

async function outsideRepo(dir) {
  let current = resolve(dir);
  while (true) {
    try { await lstat(join(current, '.git')); throw new Error('No almacenar respaldos o manifiestos dentro de un repositorio Git.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(current);
    if (current === parent) return;
    current = parent;
  }
}

async function listLocalObjects(storage, bucket) {
  const root = join(storage, bucket);
  const result = [];
  const pending = [{ dir: root, prefix: '' }];
  while (pending.length) {
    const {dir, prefix} = pending.pop();
    for (const ent of await readdir(dir, { withFileTypes:true })) {
      if (ent.isSymbolicLink() || (!ent.isFile() && !ent.isDirectory()))
        throw new Error('Storage contiene enlace simbólico u objeto irregular.');
      const name = prefix ? prefix + '/' + ent.name : ent.name;
      if (!safeName(name)) throw new Error('Ruta Storage no permitida.');
      if (ent.isDirectory()) pending.push({ dir: join(dir, ent.name), prefix:name });
      else result.push({ bucket, path:name });
    }
  }
  return result.sort((a,b) => a.path.localeCompare(b.path));
}

/**
 * Creates a local SHA-256 manifest using an independent count snapshot.
 * Neither the snapshot nor this tool proves remote completeness or restore success.
 */
export async function createOfflineManifest(rootDir, encryptedDumpName, remoteInventoryPath, {now=new Date()} = {}) {
  const root = await realpath(resolve(rootDir));
  if (!(await lstat(root)).isDirectory()) throw new Error('Ruta de respaldo no es un directorio.');
  await outsideRepo(root);
  if (!safeName(encryptedDumpName) || encryptedDumpName !== basename(encryptedDumpName) ||
      !/\.(age|gpg|enc)$/i.test(encryptedDumpName))
    throw new Error('Se requiere un archivo de respaldo cifrado .age, .gpg o .enc.');
  const dump = await normalFile(root, encryptedDumpName);
  const inventory = JSON.parse(await readFile(resolve(remoteInventoryPath), 'utf8'));
  if (inventory.project_ref !== PROJECT_REF || !Array.isArray(inventory.buckets))
    throw new Error('Inventario remoto de proyecto no válido.');
  const timestamp = Date.parse(inventory.observed_at_utc);
  const age = now.getTime() - timestamp;
  if (!Number.isFinite(timestamp) || typeof inventory.observed_at_utc !== 'string' ||
      !inventory.observed_at_utc.endsWith('Z') || age < -10*60*1000 || age > 24*60*60*1000)
    throw new Error('Inventario remoto no reciente o sin fecha UTC.');
  const expected = new Map();
  for (const entry of inventory.buckets) {
    if (!entry || !REQUIRED_BUCKETS.includes(entry.id) || expected.has(entry.id) ||
        !Number.isSafeInteger(entry.object_count) || entry.object_count<0)
      throw new Error('Buckets o cantidades del inventario remoto no válidos.');
    expected.set(entry.id, entry.object_count);
  }
  if (expected.size !== REQUIRED_BUCKETS.length) throw new Error('Faltan buckets en inventario remoto.');
  const storage = join(root, 'storage');
  const st = await lstat(storage);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Directorio Storage inválido.');
  const entries = await readdir(storage, {withFileTypes:true});
  if (entries.length !== REQUIRED_BUCKETS.length || entries.some(e=>!e.isDirectory() || !expected.has(e.name)))
    throw new Error('Buckets locales incompletos o adicionales.');
  const objects = [];
  for (const bucket of REQUIRED_BUCKETS) {
    const entries = await listLocalObjects(storage, bucket);
    if (entries.length !== expected.get(bucket))
      throw new Error('Conteo remoto/local diferente para ' + bucket + '.');
    for (const entry of entries) {
      const local = await normalFile(root, 'storage/' + entry.bucket + '/' + entry.path);
      objects.push({...entry,sha256:await sha256(local)});
    }
  }
  const manifest = {
    version:1, project_ref:PROJECT_REF, created_at_utc:now.toISOString(),
    database:{file:encryptedDumpName, sha256:await sha256(dump)},
    buckets:REQUIRED_BUCKETS.map(id=>({id,object_count:expected.get(id)})), objects,
  };
  // 'wx' prevents silently replacing an earlier manifest / audit evidence.
  const manifestPath = join(root, 'backup-manifest.local.json');
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {manifestPath,objects:objects.length,buckets:REQUIRED_BUCKETS.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [,,root,dump,remote] = process.argv;
  if (!root || !dump || !remote) {
    console.error('Uso: node scripts/recovery/create-offline-manifest.mjs <directorio-privado> <archivo-cifrado.age|gpg|enc> <inventario-remoto-privado.json>');
    process.exitCode=2;
  } else {
    try {
      const result=await createOfflineManifest(root,dump,remote);
      console.log('Manifiesto local creado para ' + result.objects + ' objetos de ' + result.buckets + ' buckets.');
      console.log('No demuestra cobertura remota integral ni restauración; conservar el manifiesto en privado.');
    } catch(err) {
      console.error('NO SE GENERÓ MANIFIESTO:',err.message);
      process.exitCode=1;
    }
  }
}