#!/usr/bin/env node
/**
 * #104: reconcile Git's legacy migration filenames against 99 REAL recorded
 * Supabase versions, using the pinned original SQL bytes recovered in #314.
 *
 * NEVER connect to Supabase or run SQL. NEVER push/repair migrations.
 * The optional temporary mirror is for offline inspection ONLY.
 */
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPinnedHistoricalArchive} from './reconstruct-applied-99.mjs';
import {gitBlobSha} from './finance-migration-gate.mjs';
import {historicSourceRoot} from './historic-sql-source.mjs';
import {inspectCutover} from './migration104-cutover-gate.mjs';

const ROOT=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const MIGRATIONS=join(ROOT,'supabase','migrations');
const LEDGER=join(ROOT,'docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json');

export function inventoryLegacyFiles(names, recorded) {
  if(!Array.isArray(names) || !Array.isArray(recorded)) throw Error('Invalid migration inventory');
  const local=names.filter(f=>f.endsWith('.sql')).map(name=>{
    const match=/^(\d{4}|\d{14})_[a-z0-9_]+\.sql$/.exec(name);
    if(!match) throw Error('Unrecognized legacy migration filename');
    return {version:match[1],name};
  });
  const counts=new Map();
  for(const row of local)counts.set(row.version,(counts.get(row.version)??0)+1);
  const duplicateLocalVersions=[...counts].filter(([,count])=>count>1).map(([version])=>version);
  const current=new Set(recorded.map(row=>row.version));
  if(current.size!==recorded.length || recorded.some(r=>!/^(\d{14})$/.test(r.version??'')))
    throw Error('Invalid or duplicated applied migration identity');
  const localVersions=new Set(local.map(r=>r.version));
  return {
    localSqlFiles:local.length,appliedVersions:recorded.length,
    exactVersionMatches:local.filter(r=>current.has(r.version)).length,
    localOnly:local.filter(r=>!current.has(r.version)).length,
    remoteOnly:recorded.filter(r=>!localVersions.has(r.version)).length,
    duplicateLocalVersions,
  };
}

function getPinned() {
  const archive=buildPinnedHistoricalArchive(); // Validates all 99 hashes and order.
  const ledger=JSON.parse(readFileSync(LEDGER,'utf8')).migrations;
  if(archive.count!==99 || archive.bytes!==493999 || ledger.length!==99)
    throw Error('Historic migration snapshot changed');
  for(let i=0;i<99;i++){
    const body=archive.bodies[i],row=ledger[i];
    if(body.version!==row.version || body.name!==row.name ||
      gitBlobSha(body.sql)!==body.sha || Buffer.byteLength(body.sql)!==body.bytes)
      throw Error('Production history source mismatch');
  }
  const legacyInventoryRoot=historicSourceRoot(ROOT);
  const inventory=inventoryLegacyFiles(readdirSync(legacyInventoryRoot),ledger);
  const activeCount=readdirSync(MIGRATIONS).filter(f=>f.endsWith('.sql')).length;
  // The 100-file active directory holds 99 immutable originals and 1 verified CRM SQL;
  // it needs exactly the original 109 SQL
  // archived AND the immutable 99-blob contract. The CI-only fixture overlay
  // remains intentionally 109 files until the workflow exits.
  if(activeCount===100) {
    const canonical=inspectCutover();
    if(!canonical.ok)throw Error('100-file canonical directory corrupted: '+canonical.errors.join('; '));
  } else if(activeCount!==109)throw Error('Unreviewed active migration file count');
  // Baseline is pinned as of 2026-11-06. Stop if the repository moves.
  if(inventory.localSqlFiles!==109 || inventory.appliedVersions!==99 ||
    inventory.exactVersionMatches!==1 || inventory.localOnly!==108 ||
    inventory.remoteOnly!==98 ||
    inventory.duplicateLocalVersions.join(',')!=='20261013040000')
    throw Error('Legacy migration inventory changed: review before reconciliation');
  return {archive,ledger,inventory};
}

export function inspectCanonicalHistory() {
  const {archive,inventory}=getPinned();
  const names=archive.bodies.map(x=>x.version+'_'+x.name+'.sql');
  if(new Set(names).size!==99 || names.some(x=>!/^[0-9]{14}_[a-z0-9_]+\.sql$/.test(x)))
    throw Error('Canonical migration filename collision');
  return {identityMatchesSnapshot:true, canonicalSqlFiles:99,
    canonicalBytes:archive.bytes, legacy:inventory,
    productionHistoryMutated:false, safeToPush:false, safeToRepair:false,
    requiresAuthenticBackupAndIsolatedRestore:true};
}

export function writeDisposableCanonicalMirror() {
  const evidence=inspectCanonicalHistory();
  const {archive}=getPinned();
  const directory=mkdtempSync(join(tmpdir(),'inmojco-104-NO-PUSH-'));
  try{
    const target=join(directory,'supabase','migrations');
    mkdirSync(target,{recursive:true,mode:0o700});
    for(const row of archive.bodies) {
      // This directory is OUTSIDE the checkout; it is not a Supabase migration
      // source of truth or a deployment workdir. Never link a remote project.
      writeFileSync(join(target,row.version+'_'+row.name+'.sql'),row.sql,{flag:'wx',mode:0o600});
    }
    writeFileSync(join(directory,'NO-PUSH-MANIFEST.json'),
      JSON.stringify({...evidence,onlyTemporaryOfflineComparison:true},null,2)+'\n',
      {flag:'wx',mode:0o600});
    return {directory,...evidence};
  }catch(error){
    rmSync(directory,{recursive:true,force:true});
    throw error;
  }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=process.argv.slice(2);
  if(arg.length>1 || (arg.length===1 && arg[0]!=='--temporary-no-push'))
    throw Error('Usage: node scripts/ops/migration104-canonical-workspace.mjs [--temporary-no-push]');
  const result=arg.length?writeDisposableCanonicalMirror():inspectCanonicalHistory();
  console.log(JSON.stringify(result,null,2));
}
