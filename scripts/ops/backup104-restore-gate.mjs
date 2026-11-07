#!/usr/bin/env node
// #104: inspect a local pg_dump archive or attest an already-restored local PG17.
// No backup bytes, tenant data, remote connections, DDL or migration commands.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createReadStream, lstatSync, realpathSync, readFileSync} from 'node:fs';
import {basename, isAbsolute, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const MANDATORY = Object.freeze([
  'auth.users',
  'storage.objects',
  'supabase_migrations.schema_migrations',
  'public.properties',
]);
const DB_NAME = 'jco_backup_104_restore_test';
const CATALOG_CHECKS = Object.freeze({
  // Names and components come from the two pinned, SELECT-only SQL snapshots.
  // A count of 'OK' lines is NOT sufficient: 14 copies of one successful
  // fingerprint could previously hide a missing or divergent object.
  consignment: Object.freeze(
    ['private.property_intake_sites', 'public.property_consignments']
      .flatMap(object => ['CATALOG_IDENTITY', 'COLUMNS', 'CONSTRAINTS',
        'INDEXES', 'POLICIES', 'TRIGGERS', 'ACL']
        .map(component => [object, component]))),
  portalAndBilling: Object.freeze([
    ['RLS_FUNCTION', 'private.can_read_portal_property(uuid,uuid)'],
    ['RLS_FUNCTION', 'public.has_portal_property(uuid)'],
    ['RLS_POLICY', 'public.properties.properties_select_portal_related'],
    ['RLS_POLICY', 'public.property_ownerships.ownerships_select_portal_owner'],
    ['COMMERCIAL_PLAN', 'BASIC'],
    ['COMMERCIAL_PLAN', 'PRO'],
    ['COMMERCIAL_PLAN', 'LIFETIME'],
    ['COMMERCIAL_PLAN', 'ENTERPRISE'],
    ['COMMERCIAL_CATALOG', 'annual-plans-unconfigured'],
    ['MIGRATION_LEDGER', 'three-unmatched-versions-absent'],
  ]),
});


export function outsideRepository(target, repoRoot = ROOT) {
  const rel = relative(resolve(repoRoot), resolve(target));
  return rel === '..' || rel.startsWith('../') || rel.startsWith('..\\');
}

export function validateArchivePath(file, repoRoot = ROOT) {
  if (!file || !isAbsolute(file)) throw Error('An absolute backup file path is required');
  if (lstatSync(file).isSymbolicLink()) throw Error('Refusing symlinked archive');
  const actual = realpathSync(file);
  if (!outsideRepository(actual, repoRoot)) throw Error('Backup must stay outside the GitHub checkout');
  const stat = lstatSync(actual);
  if (!stat.isFile() || stat.size === 0) throw Error('Backup must be a nonempty regular file');
  return {actual, size: stat.size};
}

export function parseArchiveToc(text) {
  const objects = new Set();
  for (const line of text.split(/\r?\n/)) {
    // pg_restore -l: "1234; 1259 12345 TABLE DATA auth users postgres"
    const match = /^\d+;\s+\d+\s+\d+\s+(TABLE DATA|TABLE)\s+(auth|storage|supabase_migrations|public)\s+(\S+)\s+/.exec(line);
    if (match) objects.add(match[1]+':'+match[2]+'.'+match[3]);
  }
  const checks = MANDATORY.map(name => ({
    object: name,
    schema: objects.has('TABLE:'+name),
    dataEntry: objects.has('TABLE DATA:'+name),
  }));
  return {checks, complete: checks.every(item => item.schema && item.dataEntry)};
}

export function checkCatalogOutput(output, expectedRows) {
  if (!Array.isArray(expectedRows) || !expectedRows.length ||
      expectedRows.some(pair => !Array.isArray(pair) || pair.length !== 2))
    throw Error('Catalog validation requires explicitly named fingerprint pairs');

  const expected = new Set(expectedRows.map(pair => pair.join('|')));
  if (expected.size !== expectedRows.length) throw Error('Duplicate expected fingerprint');
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  const seen = new Set();
  let passing = 0;
  let valid = true;
  for (const line of lines) {
    const parts = line.split('|');
    const key = parts.slice(0, 2).join('|');
    if (parts.length !== 3 || !expected.has(key) || seen.has(key) ||
        parts[2] !== 'OK') {
      valid = false;
    } else {
      passing++;
    }
    seen.add(key);
  }
  return {total: lines.length, passing,
    complete: valid && expected.size === seen.size && lines.length === expected.size};
}

function exec(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', timeout: 90_000, maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw Error(command+': '+(result.error.code ?? 'execution failed'));
  if (result.status !== 0) throw Error(command+' failed ('+result.status+'); inspect locally without uploading the backup');
  return result.stdout;
}

async function sha256(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function inspect(file) {
  const {actual, size} = validateArchivePath(file);
  const toc = exec('pg_restore', ['--list', actual]);
  const inventory = parseArchiveToc(toc);
  const result = {
    operation: 'OFFLINE_ARCHIVE_INVENTORY_ONLY', file: basename(actual), bytes: size,
    sha256: await sha256(actual), ...inventory,
    provenanceVerified: false, restorationVerified: false, productionMigrationAuthorized: false,
  };
  console.log(JSON.stringify(result, null, 2));
  return inventory.complete ? 0 : 2;
}

function readOnlyQuery(sql, port) {
  // Always target the dedicated test database through IPv4 loopback. Do not
  // use a port forward/tunnel to any real Supabase project.
  return exec('psql', ['-X', '-A', '-t', '-q', '-F', '|', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', DB_NAME, '-c', sql],
  {env: {...process.env, PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=30000'}}).trim();
}

function verifyRestoredDb(port) {
  if (!/^[0-9]{1,5}$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535)
    throw Error('Invalid local PostgreSQL port');
  const meta = readOnlyQuery("SELECT current_database(), current_setting('server_version_num'), current_setting('transaction_read_only')", port).split('|');
  if (meta[0] !== DB_NAME || !/^17\d{4}$/.test(meta[1] ?? '') || meta[2] !== 'on')
    throw Error('Refused: dedicated PostgreSQL 17 restore database is not verified as read-only');
  const baseline = readOnlyQuery("SELECT count(*) FROM pg_class WHERE oid IN (to_regclass('auth.users'),to_regclass('storage.objects'),to_regclass('supabase_migrations.schema_migrations'),to_regclass('public.properties')) AND relkind='r'", port);
  if (baseline !== '4') throw Error('Restored database lacks a required physical table');
  const ledger = Number(readOnlyQuery('SELECT count(*) FROM supabase_migrations.schema_migrations', port));
  const accounts = Number(readOnlyQuery('SELECT count(*) FROM auth.users', port));
  const results = [];
  for (const [name, expected] of Object.entries(CATALOG_CHECKS)) {
    const path = resolve(ROOT, name === 'consignment'
      ? 'security/checks/consignment_restore_shape_fingerprint.sql'
      : 'security/checks/unmatched_three_current_live_preflight.sql');
    // Only known SELECT-only repository queries, never user-selected SQL paths.
    const sql = readFileSync(path, 'utf8');
    results.push({name, ...checkCatalogOutput(readOnlyQuery(sql, port), expected)});
  }
  const complete = ledger === 99 && accounts > 0 && results.every(row => row.complete);
  console.log(JSON.stringify({operation: 'READ_ONLY_LOCAL_RESTORE_CATALOG',
    database: DB_NAME, postgresMajor: 17, appliedVersions: ledger,
    authUserRowsPresent: accounts > 0, checks: results, catalogMatchesBaseline: complete,
    backupProvenanceVerified: false, functionalAuthAndStorageVerified: false,
    rollbackVerified: false, productionMigrationAuthorized: false}, null, 2));
  return complete ? 0 : 2;
}

async function main(args) {
  if (args.length === 2 && args[0] === '--archive') return inspect(args[1]);
  if ((args.length === 1 || args.length === 3) && args[0] === '--verify-local-db'
      && (args.length === 1 || args[1] === '--port'))
    return verifyRestoredDb(args[2] ?? '5432');
  console.error('Usage: node scripts/ops/backup104-restore-gate.mjs --archive /ABSOLUTE/PRIVATE/backup.dump');
  console.error('   or: node scripts/ops/backup104-restore-gate.mjs --verify-local-db [--port 5432]');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(code => {process.exitCode = code;})
    .catch(error => {console.error('NO-GO #104: '+error.message); process.exitCode = 2;});
}
