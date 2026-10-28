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
  if (inventory.format_version !== 2 || inventory.project_ref !== PROJECT_REF ||
      !/^[0-9a-f]{64}$/i.test(inventory.object_keys_sha256 ?? '') ||
      !Array.isArray(inventory.buckets))
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
  // Compare exact path identities without printing private Storage names.
  // SQL uses UTF-8 hex keys, ASCII '|' delimiting and C-sorted ordering.
  const keyHex = objects.map(({bucket,path}) =>
    Buffer.from(bucket + '/' + path, 'utf8').toString('hex'))
    .sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
  const localKeysSha256 = createHash('sha256').update(keyHex.join('|'),'utf8').digest('hex');
  if (localKeysSha256 !== inventory.object_keys_sha256.toLowerCase())
    throw new Error('Identidades de Storage diferentes del inventario remoto, aun con conteos iguales.');
  // Link the local byte hashes to the downloader's original audit. A renamed
  // or overwritten file is NOT acceptable merely because the SQL path count matches.
  // This audit is ordinary private evidence, not a signed remote attestation.
  const auditFile = await normalFile(root, 'storage-download-audit.local.json');
  const audit = JSON.parse(await readFile(auditFile,'utf8'));
  if (audit.project_ref !== PROJECT_REF || !Array.isArray(audit.objects) ||
      !Array.isArray(audit.buckets) || !Number.isFinite(Date.parse(audit.downloaded_at_utc)))
    throw new Error('La auditoría original de descarga Storage es inválida o no existe.');
  const auditTime = Date.parse(audit.downloaded_at_utc);
  if (auditTime > now.getTime()+10*60*1000 || now.getTime()-auditTime > 24*60*60*1000 ||
      Math.abs(auditTime-timestamp)>60*60*1000)
    throw new Error('Auditoría Storage fuera de la ventana del inventario remoto.');
  try {
    await lstat(join(root,'STORAGE-COPIA-INCOMPLETA.txt'));
    throw new Error('Copia Storage marcada incompleta: no puede generar un manifiesto.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const auditBuckets = new Map();
  for (const bucket of audit.buckets) {
    if (!bucket || !REQUIRED_BUCKETS.includes(bucket.id) ||
        auditBuckets.has(bucket.id) || !Number.isSafeInteger(bucket.object_count) ||
        bucket.object_count < 0)
      throw new Error('Buckets inválidos en auditoría Storage.');
    auditBuckets.set(bucket.id,bucket.object_count);
  }
  if (auditBuckets.size !== expected.size ||
      [...expected].some(([id,count])=>auditBuckets.get(id)!==count))
    throw new Error('Auditoría y SQL remoto no concuerdan en buckets o cantidades.');
  const originalHashes = new Map();
  for (const obj of audit.objects) {
    if (!obj || !REQUIRED_BUCKETS.includes(obj.bucket) || !safeName(obj.path) ||
        !/^[0-9a-f]{64}$/i.test(obj.sha256) ||
        !Number.isSafeInteger(obj.size) || obj.size < 0)
      throw new Error('Objeto inválido en auditoría original de descarga.');
    const key=obj.bucket+'/'+obj.path;
    if (originalHashes.has(key)) throw new Error('Objeto repetido en auditoría Storage.');
    originalHashes.set(key,obj);
  }
  if (originalHashes.size!==objects.length)
    throw new Error('La auditoría original no contiene todos los objetos descargados.');
  for (const obj of objects) {
    const original=originalHashes.get(obj.bucket+'/'+obj.path);
    if (!original || original.sha256.toLowerCase()!==obj.sha256)
      throw new Error('Los bytes actuales difieren de la auditoría original de descarga.');
    const path=await normalFile(root,'storage/'+obj.bucket+'/'+obj.path);
    if ((await lstat(path)).size !== original.size)
      throw new Error('El tamaño local difiere de la auditoría original de descarga.');
  }
  const manifest = {
    version:1, project_ref:PROJECT_REF, created_at_utc:now.toISOString(),
    source_storage_download_at_utc: audit.downloaded_at_utc,
    source_storage_download_audit_sha256: await sha256(auditFile),
    source_inventory_observed_at_utc: inventory.observed_at_utc,
    source_object_keys_sha256: localKeysSha256,
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