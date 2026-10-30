import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const FORMAT = 'inmojco-encrypted-backup-v1';
export function deriveBackupKey(passphrase, saltHex) {
  if (typeof passphrase !== 'string' || passphrase.length < 16)
    throw new Error('Provide a backup passphrase with at least 16 characters');
  if (!/^[0-9a-f]{32}$/.test(saltHex)) throw new Error('Invalid backup salt');
  return scryptSync(passphrase, Buffer.from(saltHex, 'hex'), 32,
    { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}

function meter() {
  const hash = createHash('sha256');
  let bytes = 0;
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  return { stream, result: () => ({ bytes, sha256: hash.digest('hex') }) };
}

export async function sealStream(source, destination, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const m = meter();
  await pipeline(source, m.stream, cipher, createWriteStream(destination,
    { flags: 'wx', mode: 0o600 }));
  return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ...m.result() };
}

export async function sealBuffer(bytes, destination, key) {
  return sealStream(Readable.from([bytes]), destination, key);
}

export function validateSeal(seal) {
  if (!seal || !/^[a-f0-9]{24}$/.test(seal.iv) || !/^[a-f0-9]{32}$/.test(seal.tag)
    || !/^[a-f0-9]{64}$/.test(seal.sha256)
    || !Number.isSafeInteger(seal.bytes) || seal.bytes < 0)
    throw new Error('Backup manifest contains invalid encrypted-item metadata');
}

export async function openEncrypted(source, key, seal, outputPath) {
  validateSeal(seal);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(seal.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(seal.tag, 'hex'));
  const m = meter();
  const output = outputPath
    ? createWriteStream(outputPath, { flags: 'wx', mode: 0o600 })
    : new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  try {
    await pipeline(createReadStream(source), decipher, m.stream, output);
    const result = m.result();
    if (result.bytes !== seal.bytes || result.sha256 !== seal.sha256)
      throw new Error('Backup integrity mismatch');
  } catch {
    throw new Error('Unable to decrypt and verify backup (wrong key or damaged data)');
  }
}

export async function openEncryptedBuffer(source, key, seal) {
  validateSeal(seal);
  const bytes = await readFile(source);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(seal.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(seal.tag, 'hex'));
  let plain;
  try { plain = Buffer.concat([decipher.update(bytes), decipher.final()]); }
  catch { throw new Error('Unable to decrypt backup manifest'); }
  if (plain.length !== seal.bytes
      || createHash('sha256').update(plain).digest('hex') !== seal.sha256)
    throw new Error('Backup manifest failed integrity check');
  return plain;
}
