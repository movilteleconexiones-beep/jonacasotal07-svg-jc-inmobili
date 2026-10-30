import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { after, test } from 'node:test';
import { preflightOfflineBackup, validateOfflineTarget, assertPathOutsideRepository } from
  '../scripts/lib/inmojco-backup-preflight.mjs';

const repo = resolve('.');
const directory = await mkdtemp(join(tmpdir(),'inmojco-private-preflight-'));
after(async()=>rm(directory,{recursive:true,force:true}));

const env = () => ({
  INMOJCO_BACKUP_DIR:directory,
  SUPABASE_URL:'https://cuitgyqrjibgwuniapmk.supabase.co',
  PGHOST:'db.cuitgyqrjibgwuniapmk.supabase.co',
  PGUSER:'postgres',
  PGDATABASE:'postgres',
  PGSSLMODE:'require',
});

test('preflight needs no database, Storage or encryption secrets and makes no network calls',async()=>{
  const called=[];
  const result=await preflightOfflineBackup({env:env(),repositoryRoot:repo,
    exec:async(command,args)=>{
      called.push(command);
      assert.deepEqual(args,['--version']);
      return {stdout:command+' (PostgreSQL) 17.11 (Debian)'};
    },
  });
  assert.deepEqual(called.sort(),['pg_dump','pg_restore','psql']);
  assert.equal(result.backupCreated,false);
  assert.equal(result.credentialsChecked,false);
  assert.equal(result.destinationVerified,true);
  assert.equal(result.postgresClientMajor,17);
  assert.ok(result.availableMiB>=512);
});

test('preflight refuses the legacy Supabase project, unrelated pooler user and insecure connection',()=>{
  const valid=env();
  validateOfflineTarget(valid,directory,repo);
  validateOfflineTarget({...valid,PGHOST:'aws-0-us-west-2.pooler.supabase.com',
    PGUSER:'postgres.cuitgyqrjibgwuniapmk'},directory,repo);
  for(const invalid of [
    {SUPABASE_URL:'https://nqzopzhmhqdssgpljypu.supabase.co'},
    {PGHOST:'db.nqzopzhmhqdssgpljypu.supabase.co'},
    {PGHOST:'aws-0-us-west-2.pooler.supabase.com',PGUSER:'postgres.nqzopzhmhqdssgpljypu'},
    {PGSSLMODE:'disable'},
    {PGDATABASE:'other_database'},
  ]) assert.throws(()=>validateOfflineTarget({...valid,...invalid},directory,repo),
    /Backup preflight failed/);
});

test('preflight refuses writing archives inside the app repository',async()=>{
  await assert.rejects(()=>preflightOfflineBackup({env:{...env(),INMOJCO_BACKUP_DIR:repo},
    repositoryRoot:repo,
    exec:async()=>({stdout:'pg_dump (PostgreSQL) 17.11'})}),
  /outside the Git repository/);
});

test('missing or obsolete PostgreSQL client is a hard failure',async()=>{
  await assert.rejects(()=>preflightOfflineBackup({env:env(),repositoryRoot:repo,
    exec:async()=>({stdout:'pg_dump (PostgreSQL) 16.10'})}),
  /must be PostgreSQL client version 17/);
  await assert.rejects(()=>preflightOfflineBackup({env:env(),repositoryRoot:repo,
    exec:async()=>{throw new Error('secret details from process must be hidden');}}),
  err=>err.message.includes('must be installed')
    && !err.message.includes('secret details'));
});

test('the actual preflight CLI succeeds offline with only local PostgreSQL 17 tools',()=>{
  const r=spawnSync(process.execPath,[resolve('scripts/inmojco-backup.mjs'),'preflight'],{
    env:{...process.env,...env(),
      PGPASSWORD:'',SUPABASE_SERVICE_ROLE_KEY:'',INMOJCO_BACKUP_PASSPHRASE:''},
    encoding:'utf8',
  });
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/Local offline backup prerequisites PASS/);
  assert.match(r.stdout,/No production connection was made/);
  assert.doesNotMatch(r.stdout,/private signed contract|password\s*=/i);
});

test('Windows helper prompts for secrets only AFTER preflight and restores session values',async()=>{
  const ps = await readFile(resolve('scripts/inmojco-first-backup-windows.ps1'),'utf8');
  assert.match(ps,/Read-Host -Prompt \$Label -AsSecureString/);
  assert.match(ps,/ZeroFreeBSTR/);
  assert.match(ps,/\bpreflight\b/);
  assert.match(ps,/\bbackup\b/);
  assert.match(ps,/\$PreviousEnvironment/);
  assert.ok(ps.indexOf('preflight') < ps.indexOf('Read-PrivateValue \'Contrasena PostgreSQL'));
  assert.doesNotMatch(ps,/Write-Host.*\$(env:PGPASSWORD|env:SUPABASE_SERVICE_ROLE_KEY)/i);
});

test('same path rule permits different Windows drives for export and blocks repository locations',()=>{
  const root = 'C:\\\\dev\\\\inmojco';
  const separateDrive = 'D:\\\\INMOJCO-Respaldos';
  const sameDriveOutside = 'C:\\\\PrivateBackups';
  const insideCheckout = 'C:\\\\dev\\\\inmojco\\\\private-backup';
  assert.doesNotThrow(()=>assertPathOutsideRepository(root,separateDrive,win32));
  assert.doesNotThrow(()=>assertPathOutsideRepository(root,sameDriveOutside,win32));
  assert.throws(()=>assertPathOutsideRepository(root,insideCheckout,win32),
    /outside the Git repository/);
  assert.throws(()=>assertPathOutsideRepository(root,root,win32),
    /outside the Git repository/);
});

test('verify rejects an external symlink pointing inside Git before asking for any secrets',async()=>{
  if(process.platform==='win32') return; // Windows often requires elevated symlink privilege.
  const outside=join(directory,'redirect-to-repo');
  await symlink(repo,outside,'dir');
  const r=spawnSync(process.execPath,[resolve('scripts/inmojco-backup.mjs'),'verify'],{
    env:{...process.env,INMOJCO_BACKUP_ARCHIVE:outside,
      INMOJCO_BACKUP_PASSPHRASE:'an-example-fixture-not-a-user-secret'},
    encoding:'utf8',
  });
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/outside the Git repository/);
});
