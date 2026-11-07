#!/usr/bin/env node
// INMOJCO #104 — Offline cutover candidate contract. NEVER executes SQL.
// Preserve 99 immutable historical SQL bodies, 109 legacy sources, and one verified forward CRM migration.
import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gitBlobSha} from './finance-migration-gate.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const loadJSON=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const manifestPath='docs/ops/snapshots/migration-source-parity-2026-11-06.json';
const ledgerPath='docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json';
const archivePinPath='docs/ops/snapshots/legacy-sql-sha-2026-11-07.json';
const dest=resolve(root,'supabase/migrations');
const archive=resolve(root,'docs/ops/archive/legacy-sql-20261107');
// Independently applied in hosted production on Nov 7. Original 99 stay pinned.
const forward=Object.freeze({name:'20261107072304_website_lead_reuse_event_consent.sql',sha:'c9fdfccf55c2fd8d70da709dd50d1d56de3361d5'});

export function checkCutover({manifest,ledger,archives,canonicalFiles,legacyFiles,getCanonical,getLegacy}) {
  const errors=[];
  if(!manifest || !Array.isArray(manifest.records) || manifest.records.length!==99 ||
     !ledger || !Array.isArray(ledger.migrations) || ledger.migrations.length!==99 ||
     !archives || archives.expectedFiles!==109 || !Array.isArray(archives.files) ||
     archives.files.length!==109 || !Array.isArray(canonicalFiles) || !Array.isArray(legacyFiles))
    return {ok:false,safeToPush:false,errors:['Unreviewed or incomplete migration input']};
  const reference=manifest.records.map(r=>r.version+'_'+r.appliedName+'.sql');
  const permitted=new Set([...reference,forward.name]);
  const canonicalNames=canonicalFiles.filter(n=>n.endsWith('.sql')).sort();
  const legacyNames=legacyFiles.filter(n=>n.endsWith('.sql')).sort();
  if(canonicalNames.length!==100 || permitted.size!==100 ||
     JSON.stringify(canonicalNames)!==JSON.stringify([...permitted].sort()))
    errors.push('Canonical file names differ from 99 historical + 1 pinned forward migration');
  try {
    if(gitBlobSha(getCanonical(forward.name))!==forward.sha)
      errors.push('Verified forward CRM migration differs from applied SQL');
  } catch { errors.push('Missing verified forward CRM migration'); }
  const archivedNames=archives.files.map(x=>x.name).sort();
  if(legacyNames.length!==109 || new Set(archivedNames).size!==109 ||
      JSON.stringify(archivedNames)!==JSON.stringify(legacyNames))
    errors.push('Original 109 SQL archive incomplete or renamed');
  const ledgerNames=ledger.migrations.map(r=>r.version+'_'+r.name+'.sql');
  if(JSON.stringify(ledgerNames)!==JSON.stringify(reference))
    errors.push('Canonical historical order differs from pinned production ledger');
  for(const row of manifest.records){
    if(!/^[a-f0-9]{40}$/.test(row.appliedSqlGitBlob??'') ||
        !Number.isSafeInteger(row.appliedSqlBytes)||row.appliedSqlBytes<=0){
      errors.push('Invalid production SQL checksum '+row.version);continue;
    }
    const name=row.version+'_'+row.appliedName+'.sql';
    try {
      const bytes=getCanonical(name);
      if(bytes.length!==row.appliedSqlBytes || gitBlobSha(bytes)!==row.appliedSqlGitBlob)
        errors.push('Canonical body differs from genuine recorded SQL: '+row.version);
    } catch {errors.push('Missing canonical body '+row.version)}
  }
  for(const row of archives.files){
    if(!/^[a-f0-9]{40}$/.test(row.sha??'')||!Number.isSafeInteger(row.bytes)) {
      errors.push('Unreviewed archived SQL checksum '+row.name);continue;
    }
    try{
      const bytes=getLegacy(row.name);
      if(bytes.length!==row.bytes||gitBlobSha(bytes)!==row.sha)
        errors.push('Archived original SQL bytes changed: '+row.name);
    } catch {errors.push('Missing archived SQL '+row.name)}
  }
  const banned=['20261010212630_','20261010214633_','20261010222700_'];
  if(canonicalNames.some(n=>banned.some(prefix=>n.startsWith(prefix))))
    errors.push('Unapplied candidate SQL must never be canonicalized');
  return {ok:errors.length===0,safeToPush:false,safeToRepair:false,
    readyToMerge:false,canonicalCount:canonicalNames.length,
    archivedSources:legacyNames.length,matchedRecordedSql:99,verifiedForward:1,
    requiresHistoricalFixtureCompatibility:true,errors};
}

export function inspectCutover(){
  return checkCutover({
    manifest:loadJSON(manifestPath),ledger:loadJSON(ledgerPath),archives:loadJSON(archivePinPath),
    canonicalFiles:readdirSync(dest),legacyFiles:readdirSync(archive),
    getCanonical:n=>readFileSync(join(dest,n)),getLegacy:n=>readFileSync(join(archive,n)),
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=inspectCutover();
  console.log(JSON.stringify(result,null,2));
  if(!result.ok)process.exitCode=2;
}
