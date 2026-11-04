import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

import { validateBackupManifest } from '../scripts/lib/inmojco-backup-manifest.mjs';
import { FORMAT, deriveBackupKey, sealBuffer }
  from '../scripts/lib/inmojco-encrypted-backup.mjs';

const PROJECT = 'cuitgyqrjibgwuniapmk';
const password = 'SYNTHETIC-TEST-PASSPHRASE-NOT-FOR-PRODUCTION';
const salt = randomBytes(16).toString('hex');
const key = deriveBackupKey(password, salt);
const dir = await mkdtemp(join(tmpdir(),'inmojco-manifest-fixture-'));
after(async()=>rm(dir,{recursive:true,force:true}));

const fakeSeal = {
  iv:'1'.repeat(24), tag:'2'.repeat(32),
  sha256:'3'.repeat(64), bytes:120,
};

function manifest() {
  return {
    format:FORMAT, project:PROJECT,
    database:{file:'database.enc',seal:{...fakeSeal}},
    buckets:[{id:'organization-documents',public:false},
             {id:'jco-inventory-private',public:false}],
    objects:[
      {bucket:'organization-documents',path:'leases/mock-1.pdf',
       file:'objects/000001.enc',seal:{...fakeSeal}},
      {bucket:'jco-inventory-private',path:'floor-1/photo.jpg',
       file:'objects/000002.enc',seal:{...fakeSeal}},
    ],
    storageCoverage:{objects:2,buckets:2,fingerprint:'a'.repeat(64)},
  };
}

test('valid manifest proves references to numbered ciphertext and coverage metadata exist',()=>{
  assert.deepEqual(validateBackupManifest(manifest(),PROJECT),
    {objects:2,buckets:2,coverageRecorded:true});
  const legacy=manifest();
  delete legacy.storageCoverage;
  assert.deepEqual(validateBackupManifest(legacy,PROJECT),
    {objects:2,buckets:2,coverageRecorded:false});
});

test('rejects forged, unsafe or inconsistent Storage restore-map identities',()=>{
  const mutations = [
    m=>{m.project='nqzopzhmhqdssgpljypu';},
    m=>{m.database.file='../database.enc';},
    m=>{m.database.seal.iv='x';},
    m=>{m.objects[0].bucket='another-inmobiliaria';},
    m=>{m.objects[0].path='../../secrets';},
    m=>{m.objects[0].path='/absolute';},
    m=>{m.objects[0].path='leases/../secret';},
    m=>{m.objects[0].path='leases//secret';},
    m=>{m.objects[0].path='leases/./secret';},
    m=>{m.objects[0].path='leases\\secret';},
    m=>{m.objects[0].path='leases/secret\u0000.txt';},
    m=>{m.objects[0].path='';},
    m=>{m.objects[0].file='objects/000003.enc';},
    m=>{m.objects[0].file='../../private.enc';},
    m=>{m.objects[1].file='objects/000001.enc';},
    m=>{m.objects[1].path=m.objects[0].path;m.objects[1].bucket=m.objects[0].bucket;},
    m=>{m.objects[0].seal.tag='broken';},
    m=>{m.buckets[1].id=m.buckets[0].id;},
    m=>{m.buckets[0].id='../oops';},
    m=>{m.buckets[0].public='false';},
    m=>{m.buckets[0].id='..';},
    m=>{m.storageCoverage.objects=1;},
    m=>{m.storageCoverage.buckets=1;},
    m=>{m.storageCoverage.fingerprint='bad';},
    m=>{m.objects.push({...m.objects[1]});},
  ];
  for (const [index,mutation] of mutations.entries()) {
    const changed=manifest();
    mutation(changed);
    assert.throws(()=>validateBackupManifest(changed,PROJECT),
      /Invalid encrypted backup manifest structure/,
      'Rejected malicious variant #' + index);
  }
});

test('empty Storage with no buckets is valid, but cannot claim phantom coverage',()=>{
  const m=manifest();
  m.objects=[];m.buckets=[];m.storageCoverage={objects:0,buckets:0,fingerprint:'f'.repeat(64)};
  assert.equal(validateBackupManifest(m,PROJECT).objects,0);
  m.storageCoverage.objects=1;
  assert.throws(()=>validateBackupManifest(m,PROJECT));
});

test('CLI rejects an authenticated, tampered-reference manifest BEFORE plaintext extraction',async()=>{
  const archive=join(dir,'private-fixture');
  const out=join(dir,'never-extracted');
  await mkdir(archive);
  await mkdir(join(archive,'objects'));
  const dbSeal=await sealBuffer(Buffer.from('fake-PG-DUMP-data'),
    join(archive,'database.enc'),key);
  const objSeal=await sealBuffer(Buffer.from('fictional lease PDF bytes'),
    join(archive,'objects/000001.enc'),key);
  const m=manifest();
  m.database.seal=dbSeal;
  m.buckets=[{id:'organization-documents',public:false}];
  m.objects=[{bucket:'organization-documents',path:'leases/../sensitive.pdf',
    file:'objects/000001.enc',seal:objSeal}];
  m.storageCoverage={objects:1,buckets:1,fingerprint:'a'.repeat(64)};
  const manifestSeal=await sealBuffer(Buffer.from(JSON.stringify(m)),
    join(archive,'manifest.enc'),key);
  await writeFile(join(archive,'backup-meta.json'),JSON.stringify({
    format:FORMAT,project:PROJECT,salt,manifestSeal,
  }));
  const script=resolve('scripts/inmojco-backup.mjs');
  const env={...process.env,INMOJCO_BACKUP_ARCHIVE:archive,
    INMOJCO_BACKUP_PASSPHRASE:password,
    INMOJCO_EXTRACT_DIR:out};
  for(const command of ['verify','extract']) {
    const p=spawnSync(process.execPath,[script,command],{env,encoding:'utf8'});
    assert.notEqual(p.status,0,'Unsafe manifest passed ' + command);
    assert.match(p.stderr,/Invalid encrypted backup manifest structure/);
    assert.doesNotMatch(p.stderr,/fictional lease PDF/);
  }
  await assert.rejects(()=>readFile(join(out,'restore-map.json')), {code:'ENOENT'});
});
