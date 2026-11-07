import assert from 'node:assert/strict';
import {readFileSync,readdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {gitBlobSha} from '../scripts/ops/finance-migration-gate.mjs';
import {
  inventoryLegacyFiles,inspectCanonicalHistory,writeDisposableCanonicalMirror,
} from '../scripts/ops/migration104-canonical-workspace.mjs';
import {buildPinnedHistoricalArchive} from '../scripts/ops/reconstruct-applied-99.mjs';

test('#104: legacy local tree cannot be trusted as remotely applied history',()=>{
  const report=inspectCanonicalHistory();
  assert.deepEqual(report.legacy,{
    localSqlFiles:109,appliedVersions:99,exactVersionMatches:1,
    localOnly:108,remoteOnly:98,
    duplicateLocalVersions:['20261013040000'],
  });
  assert.equal(report.identityMatchesSnapshot,true);
  assert.equal(report.canonicalSqlFiles,99);
  assert.equal(report.canonicalBytes,493999);
  assert.equal(report.safeToPush,false);
  assert.equal(report.safeToRepair,false);
  assert.equal(report.productionHistoryMutated,false);
  assert.equal(report.requiresAuthenticBackupAndIsolatedRestore,true);
});

test('#104: detect duplicate local versions and unexpected ledger identities',()=>{
  const legacy=['0001_initial.sql','20261013040000_one.sql','20261013040000_two.sql',
    '20261029000000_another.sql','README.md'];
  const ledger=[
    {version:'20261013040000',name:'one'},
    {version:'20261029000000',name:'another'},
    {version:'20261031000000',name:'newest'},
  ];
  assert.deepEqual(inventoryLegacyFiles(legacy,ledger),{
    localSqlFiles:4,appliedVersions:3,exactVersionMatches:3,
    localOnly:1,remoteOnly:1,duplicateLocalVersions:['20261013040000'],
  });
  assert.throws(()=>inventoryLegacyFiles(['not_a_migration.sql'],ledger),/Unrecognized/);
  assert.throws(()=>inventoryLegacyFiles([],ledger.concat(ledger[0])),/duplicated/);
});

test('#104: recovered 99 original SQL bodies form a separate temporary mirror only',()=>{
  const mirror=writeDisposableCanonicalMirror();
  try{
    assert.ok(resolve(mirror.directory).startsWith(resolve(tmpdir())));
    assert.match(mirror.directory,/inmojco-104-NO-PUSH-/);
    const location=join(mirror.directory,'supabase','migrations');
    const names=readdirSync(location).sort();
    const originals=buildPinnedHistoricalArchive().bodies;
    assert.equal(names.length,99);
    assert.deepEqual(names,originals.map(b=>b.version+'_'+b.name+'.sql').sort());
    assert.ok(!names.some(n=>n.startsWith('20261010222700_')));
    let total=0;
    for(const original of originals){
      const bytes=readFileSync(join(location,original.version+'_'+original.name+'.sql'));
      assert.equal(gitBlobSha(bytes),original.sha);
      assert.equal(bytes.length,original.bytes);
      total+=bytes.length;
    }
    assert.equal(total,493999);
    const receipt=JSON.parse(readFileSync(join(mirror.directory,'NO-PUSH-MANIFEST.json'),'utf8'));
    assert.deepEqual([receipt.safeToPush,receipt.safeToRepair,receipt.onlyTemporaryOfflineComparison],
      [false,false,true]);
    assert.equal(readdirSync(mirror.directory).length,2);
  } finally {
    rmSync(mirror.directory,{recursive:true,force:true});
  }
});

test('#104: migration mirror never connects, executes SQL, repairs history or changes repo',()=>{
  const file=readFileSync(new URL('../scripts/ops/migration104-canonical-workspace.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(file,/\b(?:child_process|execSync|spawnSync|pg_restore|psql|supabase db push)\b/);
  assert.doesNotMatch(file,/SUPABASE_SERVICE_ROLE_KEY|PGPASSWORD|DATABASE_URL|supabase link/);
  assert.match(file,/NO-PUSH/);
  assert.match(file,/safeToPush:false, safeToRepair:false/);
});
