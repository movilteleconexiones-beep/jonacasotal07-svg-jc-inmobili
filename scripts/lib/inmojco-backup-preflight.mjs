/**
 * Zero-credential preflight for an operator-controlled offline backup.
 * This module NEVER connects to Supabase, writes customer data, or reads keys.
 * A PASS means only local prerequisites are ready — NOT that a backup exists.
 */
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpath, statfs, open, rm } from 'node:fs/promises';
import { relative, join, isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const runTool = promisify(execFile);
const PROJECT = 'cuitgyqrjibgwuniapmk';
const URL = 'https://' + PROJECT + '.supabase.co';
const MIN_SPACE_BYTES = 512n * 1024n * 1024n;

function rejection(reason) { return new Error('Backup preflight failed: ' + reason); }

export function validateOfflineTarget(env, directory, repository) {
  if (env.SUPABASE_URL?.replace(/\/$/, '') !== URL)
    throw rejection('wrong Supabase project URL');
  if (env.PGDATABASE !== 'postgres')
    throw rejection('expected PostgreSQL database "postgres"');
  const host = env.PGHOST?.trim().toLowerCase() ?? '';
  const user = env.PGUSER?.trim().toLowerCase() ?? '';
  const direct = host === 'db.' + PROJECT + '.supabase.co' && user === 'postgres';
  const pooler = /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(host)
    && user === 'postgres.' + PROJECT;
  if (!direct && !pooler)
    throw rejection('PostgreSQL host and username must identify the active INMOJCO project');
  if (!['require', 'verify-ca', 'verify-full'].includes(env.PGSSLMODE))
    throw rejection('a secure PostgreSQL SSL mode is required');
  if (!env.INMOJCO_BACKUP_DIR || !directory)
    throw rejection('an existing absolute private backup folder is required');
  assertPathOutsideRepository(repository, directory);

}

/**
 * A single path rule shared by the private preflight and the real exporter.
 * On Windows, a destination on a DIFFERENT drive returns an absolute relative
 * path; this is safe and must be accepted. Callers must resolve symlinks first.
 */
export function assertPathOutsideRepository(repository, directory,
  pathApi = { relative, isAbsolute }) {
  const toRepo = pathApi.relative(repository, directory);
  const outside = toRepo === '..' || toRepo.startsWith('../')
    || toRepo.startsWith('..\\') || pathApi.isAbsolute(toRepo);
  if (!toRepo || !outside)
    throw rejection('the backup location must be outside the Git repository');
}

async function checkPostgresTool(executable, exec = runTool) {
  let version;
  try {
    const r = await exec(executable, ['--version'],
      { timeout: 10000, maxBuffer: 4096, windowsHide: true });
    version = String(r.stdout);
  } catch { throw rejection(executable + ' must be installed and available on PATH'); }
  const major = version.match(/\(PostgreSQL\)\s+(\d+)(?:\.\d+)?\b/);
  if (!major || Number(major[1]) !== 17)
    throw rejection(executable + ' must be PostgreSQL client version 17');
  return 17;
}

export async function preflightOfflineBackup({
  env = process.env, repositoryRoot, exec = runTool,
  fs = { realpath, statfs, open, rm },
} = {}) {
  if (Number(process.versions.node.split('.')[0]) < 20)
    throw rejection('Node.js 20 or newer is required');
  if (!repositoryRoot || !env.INMOJCO_BACKUP_DIR)
    throw rejection('missing local repository/backup folder');
  if (!isAbsolute(env.INMOJCO_BACKUP_DIR))
    throw rejection('the backup folder must have an absolute path');
  let repo, folder;
  try {
    [repo,folder] = await Promise.all([fs.realpath(repositoryRoot),
      fs.realpath(env.INMOJCO_BACKUP_DIR)]);
  } catch { throw rejection('the private backup directory does not exist'); }
  validateOfflineTarget(env, folder, repo);
  let capacity;
  try {
    const stats = await fs.statfs(folder, { bigint: true });
    capacity = BigInt(stats.bsize) * BigInt(stats.bavail);
    if (capacity < MIN_SPACE_BYTES)
      throw rejection('less than 512 MiB free on backup destination');
  } catch (error) {
    if (error?.message?.startsWith('Backup preflight failed:')) throw error;
    throw rejection('cannot verify available backup disk space');
  }
  const probePath = join(folder, '.inmojco-private-write-probe-'
    + randomBytes(8).toString('hex'));
  let descriptor;
  try {
    descriptor = await fs.open(probePath, 'wx', 0o600);
  } catch { throw rejection('private backup folder is not writable'); }
  finally {
    if (descriptor) {
      await descriptor.close();
      await fs.rm(probePath, { force: true }).catch(() => {});
    }
  }
  // No network calls: only confirm that the local clients are compatible.
  await Promise.all(['pg_dump', 'pg_restore', 'psql']
    .map(tool => checkPostgresTool(tool, exec)));
  return { postgresClientMajor: 17, minSpaceMiB: 512,
    availableMiB: Number(capacity / (1024n * 1024n)),
    project: PROJECT, destinationVerified: true, credentialsChecked: false,
    backupCreated: false };
}
