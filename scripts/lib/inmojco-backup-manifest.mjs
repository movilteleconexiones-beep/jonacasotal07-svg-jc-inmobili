/**
 * Fail-closed structural validation of a decrypted INMOJCO backup manifest.
 *
 * AES-GCM authenticates encrypted bytes but does not imply the manifest
 * describes unique, complete or safe Storage object identities. This module
 * validates references BEFORE any plaintext extraction begins.
 *
 * This check is NOT proof that a real database or Storage has been restored.
 */
import { FORMAT, validateSeal } from './inmojco-encrypted-backup.mjs';

const BUCKET_ID = /^[A-Za-z0-9_.-]+$/;
const ENCRYPTED_OBJECT = /^objects\/([0-9]{6})\.enc$/;
const COVERAGE_HASH = /^[a-f0-9]{64}$/;
const MAX_OBJECTS = 999999;

function reject() {
  throw new Error('Invalid encrypted backup manifest structure');
}

function validateStorageKey(key) {
  if (typeof key !== 'string' || !key || key.startsWith('/')
      || key.includes('\\') || /[\x00-\x1f\x7f]/.test(key)
      || key.split('/').some(part => !part || part === '.' || part === '..')) {
    reject();
  }
}

/**
 * @param {unknown} manifest - Already authenticated and decrypted JSON.
 * @param {string} expectedProject - Pinned source Supabase project ID.
 * @returns {{coverageRecorded:boolean,objects:number,buckets:number}}
 */
export function validateBackupManifest(manifest, expectedProject) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || manifest.format !== FORMAT || manifest.project !== expectedProject
      || manifest.database?.file !== 'database.enc'
      || !Array.isArray(manifest.buckets) || !Array.isArray(manifest.objects)
      || manifest.objects.length > MAX_OBJECTS) reject();

  try { validateSeal(manifest.database.seal); }
  catch { reject(); }

  const bucketIds = new Set();
  for (const bucket of manifest.buckets) {
    if (!bucket || typeof bucket !== 'object'
        || typeof bucket.id !== 'string'
        || !BUCKET_ID.test(bucket.id)
        || bucket.id === '.' || bucket.id === '..'
        || typeof bucket.public !== 'boolean'
        || bucketIds.has(bucket.id)) reject();
    bucketIds.add(bucket.id);
  }

  const objectKeys = new Set();
  const encryptedFiles = new Set();
  for (let index = 0; index < manifest.objects.length; index++) {
    const object = manifest.objects[index];
    if (!object || typeof object !== 'object' || Array.isArray(object)
        || typeof object.bucket !== 'string'
        || !bucketIds.has(object.bucket)) reject();
    validateStorageKey(object.path);
    const match = typeof object.file === 'string'
      ? ENCRYPTED_OBJECT.exec(object.file) : null;
    // In normal exports, numbered files are contiguous and assigned once.
    // Missing or repeated numbers must never silently yield a "complete" backup.
    if (!match || Number(match[1]) !== index + 1
        || encryptedFiles.has(object.file)) reject();
    try { validateSeal(object.seal); }
    catch { reject(); }
    const key = JSON.stringify([object.bucket, object.path]);
    if (objectKeys.has(key)) reject();
    objectKeys.add(key);
    encryptedFiles.add(object.file);
  }

  const coverageRecorded = manifest.storageCoverage != null;
  if (coverageRecorded) {
    const c = manifest.storageCoverage;
    if (!c || typeof c !== 'object' || Array.isArray(c)
      || !Number.isSafeInteger(c.objects) || c.objects !== objectKeys.size
      || !Number.isSafeInteger(c.buckets) || c.buckets !== bucketIds.size
      || typeof c.fingerprint !== 'string'
      || !COVERAGE_HASH.test(c.fingerprint)) reject();
  }

  return {
    objects: objectKeys.size,
    buckets: bucketIds.size,
    coverageRecorded,
  };
}
