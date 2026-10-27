#!/usr/bin/env node
// Offline file-integrity checks only. Never uploads backups or claims restore success.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const BUCKET_ID = /^[a-z0-9][a-z0-9_-]*$/;
const PROJECT_REF = 'cuitgyqrjibgwuniapmk';

function relativeName(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      isAbsolute(value) || value.split('/').some(s => !s || s === '.' || s === '..' || s.includes(':')))
    throw new Error('Ruta relativa no válida en el manifiesto.');
  return value;
}

async function fileHash(root, name) {
  const target = resolve(root, ...relativeName(name).split('/'));
  const canonical = await realpath(target);
  const rel = relative(root, canonical);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
    throw new Error('Archivo fuera del directorio de respaldo.');
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Los archivos verificados deben ser archivos regulares.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(canonical)) hash.update(chunk);
  return hash.digest('hex');
}

function validateDigest(hash) {
  if (typeof hash !== 'string' || !HEX_SHA256.test(hash))
    throw new Error('Huella SHA-256 inválida en el manifiesto.');
  return hash.toLowerCase();
}

/** Verify listed bytes only; completeness, provenance and restorability need independent proof. */
export async function verifyBackupIntegrity(manifestPath, backupRoot) {
  const root = await realpath(resolve(backupRoot));
  const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
  if (manifest.version !== 1 || manifest.project_ref !== PROJECT_REF ||
      !Number.isFinite(Date.parse(manifest.created_at_utc)) ||
      !/^\d{4}-\d\d-\d\dT.*Z$/.test(manifest.created_at_utc) ||
      !manifest.database || !Array.isArray(manifest.buckets) || !Array.isArray(manifest.objects))
    throw new Error('Manifiesto de respaldo no válido.');

  const expected = validateDigest(manifest.database.sha256);
  if (await fileHash(root, relativeName(manifest.database.file)) !== expected)
    throw new Error('Huella SHA-256 de PostgreSQL no coincide.');

  const counts = new Map();
  for (const bucket of manifest.buckets) {
    if (!bucket || typeof bucket.id !== 'string' || !BUCKET_ID.test(bucket.id) ||
        !Number.isSafeInteger(bucket.object_count) || bucket.object_count < 0 || counts.has(bucket.id))
      throw new Error('Inventario de buckets inválido o duplicado.');
    counts.set(bucket.id, { expected: bucket.object_count, actual: 0 });
  }
  const seen = new Set();
  for (const [index, object] of manifest.objects.entries()) {
    if (!object || !counts.has(object.bucket)) throw new Error('Objeto sin bucket registrado.');
    const name = relativeName(object.path);
    const key = object.bucket + '/' + name;
    if (seen.has(key)) throw new Error('Objeto repetido en el manifiesto.');
    seen.add(key);
    counts.get(object.bucket).actual++;
    if (await fileHash(root, 'storage/' + key) !== validateDigest(object.sha256))
      throw new Error('Huella SHA-256 de Storage no coincide (entrada ' + (index + 1) + ').');
  }
  for (const entry of counts.values()) {
    if (entry.actual !== entry.expected) throw new Error('Conteo de objetos no coincide con el manifiesto.');
  }
  return { objects_verified: seen.size, buckets_verified: counts.size, db_verified: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , manifestPath, backupRoot] = process.argv;
  if (!manifestPath || !backupRoot) {
    console.error('Uso: node verify-backup-integrity.mjs <manifiesto-privado.json> <directorio-de-respaldo>');
    process.exitCode = 2;
  } else {
    try {
      const result = await verifyBackupIntegrity(manifestPath, backupRoot);
      console.log('Integridad verificada: 1 archivo PostgreSQL, ' + result.objects_verified +
        ' objetos en ' + result.buckets_verified + ' buckets.');
      console.log('NO acredita cobertura completa, procedencia, descifrado ni restauración efectiva.');
    } catch (error) {
      console.error('VERIFICACIÓN FALLIDA:', error.message);
      process.exitCode = 1;
    }
  }
}
