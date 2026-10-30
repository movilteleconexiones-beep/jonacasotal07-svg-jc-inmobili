import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { FORMAT, deriveBackupKey, sealBuffer, openEncryptedBuffer, openEncrypted }
  from '../scripts/lib/inmojco-encrypted-backup.mjs';
import { listStorageObjects } from '../scripts/inmojco-backup.mjs';

const tmp = await mkdtemp(join(tmpdir(), 'inmojco-crypto-fixture-'));
after(async () => rm(tmp, { recursive: true, force: true }));
const passphrase = 'unique-test-passphrase-NOT-A-PRODUCTION-SECRET';
const salt = randomBytes(16).toString('hex');
const key = deriveBackupKey(passphrase, salt);

test('authenticated 256-bit encryption decrypts only with valid passphrase', async () => {
  const value = Buffer.from('private signed contract bytes and account data');
  const file = join(tmp,'encrypted-1.bin');
  const seal = await sealBuffer(value,file,key);
  assert.notDeepEqual(await readFile(file),value);
  assert.deepEqual(await openEncryptedBuffer(file,key,seal),value);
  const extracted = join(tmp,'decrypted-1.bin');
  await openEncrypted(file,key,seal,extracted);
  assert.deepEqual(await readFile(extracted),value);
  const wrongKey = deriveBackupKey('another-test-passphrase-NOT-PRODUCTION',salt);
  await assert.rejects(() => openEncryptedBuffer(file,wrongKey,seal),
    /Unable to decrypt/);
});

test('single ciphertext change fails verification, even with an intact manifest',async()=>{
  const file=join(tmp,'encrypted-2.bin');
  const seal=await sealBuffer(Buffer.from('critical-data'),file,key);
  const edited=await readFile(file);
  edited[0]^=0x40;
  await writeFile(file,edited);
  await assert.rejects(()=>openEncryptedBuffer(file,key,seal),/Unable to decrypt/);
  await assert.rejects(()=>openEncrypted(file,key,seal),/Unable to decrypt/);
});

test('Storage listing covers 100-item pagination and private nested folders',async()=>{
  const root=Array.from({length:104},(_,i)=>({id:'file-'+i,name:'file-'+String(i).padStart(3,'0')+'.pdf'}));
  root.push({id:null,name:'signed-contracts'});
  root.sort((a,b)=>a.name.localeCompare(b.name));
  const calls=[];
  const storage={from(bucket){
    assert.equal(bucket,'organization-documents');
    return {async list(prefix,{offset,limit}){
      calls.push({prefix,offset,limit});
      const rows=prefix==='signed-contracts'
        ?[{name:'test-lease.pdf',id:'signed-1'}]:root;
      return {data:rows.slice(offset,offset+limit),error:null};
    }};
  }};
  const objects=await listStorageObjects(storage,'organization-documents');
  assert.equal(objects.length,105);
  assert.ok(objects.includes('signed-contracts/test-lease.pdf'));
  assert.ok(calls.some(x=>x.prefix===''&&x.offset===100));
  assert.ok(calls.some(x=>x.prefix==='signed-contracts'));
});

test('Storage read errors fail closed and never report a successful backup',async()=>{
  const storage={from(){return {async list(){return {data:null,error:{message:'backend unavailable'}};}}}};
  await assert.rejects(()=>listStorageObjects(storage,'organization-documents'),/Unable to enumerate/);
});

test('offline verify and extract work with an encrypted DB plus private Storage fixture',async()=>{
  const archive=join(tmp,'archive');
  await mkdir(archive);
  await mkdir(join(archive,'objects'));
  const dbSeal=await sealBuffer(Buffer.from('PGDMP-mock-bytes-for-local-crypto-test'),
    join(archive,'database.enc'),key);
  const storageSeal=await sealBuffer(Buffer.from('%PDF-signed-document-fixture'),
    join(archive,'objects/000001.enc'),key);
  const manifest={format:FORMAT,project:'cuitgyqrjibgwuniapmk',createdAt:new Date().toISOString(),
    buckets:[{id:'organization-documents',public:false}],
    database:{file:'database.enc',seal:dbSeal},
    objects:[{bucket:'organization-documents',path:'leases/private.pdf',
      file:'objects/000001.enc',seal:storageSeal}]};
  const manifestSeal=await sealBuffer(Buffer.from(JSON.stringify(manifest)),
    join(archive,'manifest.enc'),key);
  await writeFile(join(archive,'backup-meta.json'),JSON.stringify({format:FORMAT,
    project:'cuitgyqrjibgwuniapmk',salt,manifestSeal}));
  const script=resolve('scripts/inmojco-backup.mjs');
  const env={...process.env,INMOJCO_BACKUP_ARCHIVE:archive,
    INMOJCO_BACKUP_PASSPHRASE:passphrase};
  const verify=spawnSync(process.execPath,[script,'verify'],{env,encoding:'utf8'});
  assert.equal(verify.status,0,verify.stderr);
  assert.match(verify.stdout,/Cryptographic verification passed/);
  const dir=join(tmp,'extracted');
  const extract=spawnSync(process.execPath,[script,'extract'],
    {env:{...env,INMOJCO_EXTRACT_DIR:dir},encoding:'utf8'});
  assert.equal(extract.status,0,extract.stderr);
  assert.equal((await readFile(join(dir,'database.dump'))).toString(),
    'PGDMP-mock-bytes-for-local-crypto-test');
  assert.equal((await readFile(join(dir,'objects/000001.bin'))).toString(),
    '%PDF-signed-document-fixture');
  const map=JSON.parse(await readFile(join(dir,'restore-map.json'),'utf8'));
  assert.equal(map.objects[0].bucket,'organization-documents');
  assert.equal(map.objects[0].path,'leases/private.pdf');
  assert.notEqual(map.objects[0].file,manifest.objects[0].file);
  const second=spawnSync(process.execPath,[script,'extract'],
    {env:{...env,INMOJCO_EXTRACT_DIR:dir},encoding:'utf8'});
  assert.notEqual(second.status,0,'must never overwrite a previous plaintext extraction');
  if (process.platform !== 'win32') {
    // A deceptive external link pointing to the repository must not allow
    // plaintext contracts to leak into source control during extraction.
    const redirection=join(tmp,'external-repo-redirect');
    await symlink(resolve('.'),redirection,'dir');
    const blocked=spawnSync(process.execPath,[script,'extract'],{
      env:{...env,INMOJCO_EXTRACT_DIR:join(redirection,'never-write-private-documents')},
      encoding:'utf8',
    });
    assert.notEqual(blocked.status,0);
    assert.match(blocked.stderr,/outside the Git repository/);
  }
});

test('backup always requires local encryption secret and private outside-repo destination',()=>{
  const result=spawnSync(process.execPath,[resolve('scripts/inmojco-backup.mjs'),'backup'],
    {env:{...process.env,INMOJCO_BACKUP_PASSPHRASE:''},encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Missing required local environment variable/);
});

test('inspect recognizes a genuine PostgreSQL 17 custom archive without restoring data',async()=>{
  const archive=join(tmp,'real-postgres-dump');
  await mkdir(archive);
  await mkdir(join(archive,'objects'));
  const pg=spawnSync('pg_dump',['--format=custom','--no-password',
    '--host=localhost','--username=postgres','--dbname=jco_backup_format_test'],
    { env:{...process.env,PGPASSWORD:'postgres'},maxBuffer:16*1024*1024 });
  assert.equal(pg.status,0,'CI fixture PostgreSQL pg_dump must succeed');
  assert.equal(pg.stdout.subarray(0,5).toString(),'PGDMP');
  const dbSeal=await sealBuffer(pg.stdout,join(archive,'database.enc'),key);
  const manifest={format:FORMAT,project:'cuitgyqrjibgwuniapmk',
    database:{file:'database.enc',seal:dbSeal},buckets:[],objects:[]};
  const manifestSeal=await sealBuffer(Buffer.from(JSON.stringify(manifest)),
    join(archive,'manifest.enc'),key);
  await writeFile(join(archive,'backup-meta.json'),JSON.stringify({format:FORMAT,
    project:'cuitgyqrjibgwuniapmk',salt,manifestSeal}));

  const run=spawnSync(process.execPath,[resolve('scripts/inmojco-backup.mjs'),'inspect'],
    {env:{...process.env,INMOJCO_BACKUP_ARCHIVE:archive,
      INMOJCO_BACKUP_PASSPHRASE:passphrase},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout,/PostgreSQL archive catalog readable/);
  assert.match(run.stdout,/tableEntries: [1-9]/);
  assert.ok(!(await readFile(join(archive,'database.enc'))).subarray(0,5).equals(Buffer.from('PGDMP')));
});

test('inspect rejects encrypted garbage even though its GCM/SHA-256 are valid',async()=>{
  const archive=join(tmp,'garbage-postgres-dump');
  await mkdir(archive);
  await mkdir(join(archive,'objects'));
  const dbSeal=await sealBuffer(Buffer.from('NOT-A-POSTGRES-CUSTOM-DUMP'),
    join(archive,'database.enc'),key);
  const manifest={format:FORMAT,project:'cuitgyqrjibgwuniapmk',
    database:{file:'database.enc',seal:dbSeal},buckets:[],objects:[]};
  const manifestSeal=await sealBuffer(Buffer.from(JSON.stringify(manifest)),
    join(archive,'manifest.enc'),key);
  await writeFile(join(archive,'backup-meta.json'),JSON.stringify({format:FORMAT,
    project:'cuitgyqrjibgwuniapmk',salt,manifestSeal}));
  const run=spawnSync(process.execPath,[resolve('scripts/inmojco-backup.mjs'),'inspect'],
    {env:{...process.env,INMOJCO_BACKUP_ARCHIVE:archive,
      INMOJCO_BACKUP_PASSPHRASE:passphrase},encoding:'utf8'});
  assert.notEqual(run.status,0,'a well-encrypted invalid SQL dump must fail inspect');
  assert.match(run.stderr,/PostgreSQL backup structure or encrypted integrity invalid/);
  assert.doesNotMatch(run.stderr,/PGDMP|NOT-A-POSTGRES/);
});
