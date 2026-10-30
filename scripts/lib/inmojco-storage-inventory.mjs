/**
 * Read-only consistency guard for private Supabase Storage objects.
 *
 * A valid AES-GCM tag proves encrypted bytes were not altered; it does NOT
 * establish that every object existing at pg_dump time was downloaded.
 * Comparing the actual DB metadata before/after the export prevents silently
 * accepting an archive made while the private object inventory changed.
 *
 * NEVER include raw inventory rows, object paths or psql stderr in logs.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_INVENTORY_BYTES = 32 * 1024 * 1024;
export const STORAGE_INVENTORY_SQL = `
select row_to_json(row_data)::text
from (
  select 'bucket'::text as kind, id as bucket, null::text as path,
         concat_ws('|',name,public::text,updated_at::text) as revision
  from storage.buckets
  union all
  select 'object'::text, bucket_id, name,
         concat_ws('|',id::text,version,updated_at::text,md5(metadata::text))
  from storage.objects
) as row_data
order by kind, bucket, path;
`;

function failed() {
  return new Error('Storage database inventory cannot be verified; backup rejected');
}

/**
 * @returns {{buckets: Map<string, string>, objects: Map<string,string>, sha256: string}}
 * All identifiers are kept in memory, never printed or written unencrypted.
 */
export function parseStorageInventory(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_INVENTORY_BYTES)
    throw failed();
  const buckets = new Map();
  const objects = new Map();
  const canonical = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    let item;
    try { item = JSON.parse(line); } catch { throw failed(); }
    if (typeof item?.bucket !== 'string' || !item.bucket
      || item.bucket.includes('\0') || typeof item.revision !== 'string')
      throw failed();
    if (item.kind === 'bucket') {
      if (buckets.has(item.bucket) || item.path !== null) throw failed();
      buckets.set(item.bucket, item.revision);
    } else if (item.kind === 'object') {
      if (typeof item.path !== 'string' || !item.path || item.path.includes('\0'))
        throw failed();
      const key = item.bucket + '\0' + item.path;
      if (objects.has(key)) throw failed();
      objects.set(key, item.revision);
    } else throw failed();
    canonical.push([item.kind, item.bucket, item.path, item.revision]);
  }
  // Key order and SQL formatting must not affect identity. This fingerprint
  // summarizes metadata changes; exact keys are compared separately below.
  canonical.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const sha256 = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return { buckets, objects, sha256 };
}

export function verifyStorageCoverage(before, after, copied, copiedBuckets) {
  if (!(before?.buckets instanceof Map) || !(after?.buckets instanceof Map)
    || !(before?.objects instanceof Map) || !(after?.objects instanceof Map)
    || !Array.isArray(copied) || !Array.isArray(copiedBuckets))
    throw failed();

  // A snapshot that changed during pg_dump/Storage download cannot be called
  // a consistent backup. Revisions include version, updated_at and metadata.
  if (before.sha256 !== after.sha256
    || before.buckets.size !== after.buckets.size
    || before.objects.size !== after.objects.size)
    throw failed();

  const copiedBucketSet = new Set(copiedBuckets);
  if (copiedBucketSet.size !== before.buckets.size)
    throw failed();
  for (const [bucket, revision] of before.buckets) {
    if (after.buckets.get(bucket) !== revision || !copiedBucketSet.has(bucket))
      throw failed();
  }

  const seen = new Set();
  if (copied.length !== before.objects.size) throw failed();
  for (const item of copied) {
    const key = item?.bucket + '\0' + item?.path;
    if (!before.objects.has(key) || !after.objects.has(key)
      || before.objects.get(key) !== after.objects.get(key) || seen.has(key))
      throw failed();
    seen.add(key);
  }
  return { objects: before.objects.size, buckets: before.buckets.size,
    fingerprint: before.sha256 };
}

export async function readStorageInventory(env = process.env) {
  const needed = ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
  if (needed.some(name => !env[name])) throw failed();
  try {
    const { stdout } = await execFileAsync('psql', [
      '--no-password', '--no-align', '--tuples-only', '--quiet',
      '--set=ON_ERROR_STOP=1', '--command', STORAGE_INVENTORY_SQL,
    ], {
      env: { ...env, PGSSLMODE: env.PGSSLMODE ?? 'require' },
      timeout: 90000, maxBuffer: MAX_INVENTORY_BYTES,
      windowsHide: true,
    });
    return parseStorageInventory(stdout);
  } catch {
    // PostgreSQL stderr can include connection strings or private metadata.
    throw failed();
  }
}
