// Issue #104: keep original historical SQL provenance valid after canonical
// migration-directory cutover. Do not create symlinks or change any SQL bytes.
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';

export function historicSourceRoot(projectRoot){
  const checkout=resolve(projectRoot,'supabase/migrations');
  const archive=resolve(projectRoot,'docs/ops/archive/legacy-sql-20261107');
  const pinned=resolve(projectRoot,'docs/ops/snapshots/legacy-sql-sha-2026-11-07.json');
  // The 109-source archive exists ONLY after canonical cutover. If someone
  // deletes a pinned original from the archive, fail rather than trust a
  // similarly named canonical file with different contents.
  if(existsSync(pinned)){
    if(!existsSync(archive))throw Error('Historic 109-source archive missing');
    return archive;
  }
  return checkout;
}
export function historicSqlFile(projectRoot,filename){
  if(typeof filename!=='string'||!/^(?:\d{4}|\d{14})_[a-z0-9_]+\.sql$/.test(filename))
    throw Error('Unreviewed historical SQL filename');
  return resolve(historicSourceRoot(projectRoot),filename);
}
export function historicalInventory(projectRoot){
  return readdirSync(historicSourceRoot(projectRoot)).filter(f=>f.endsWith('.sql'));
}
export function readHistoricSql(projectRoot,filename){
  return readFileSync(historicSqlFile(projectRoot,filename));
}
