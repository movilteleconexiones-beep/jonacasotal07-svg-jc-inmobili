#!/usr/bin/env node
// Operator-side private Storage snapshot. Never used by CI against real Supabase.
// The service-role key stays ONLY in the operator's local environment.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

export const PROJECT_REF = 'cuitgyqrjibgwuniapmk';
export const REQUIRED_BUCKETS = [
  'jco-consignment-photos', 'jco-inventory-private',
  'jco-rent-receipts-private', 'organization-documents',
];

function safeComponent(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || value.includes('/') ||
      /[\\\\\x00-\x1f<>:"|?*]/.test(value) || /[. ]$/.test(value) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(value))
    throw new Error('Storage contiene un nombre no seguro para el sistema local.');
  return value;
}
function checkedObjectPath(value) {
  if (typeof value !== 'string' || isAbsolute(value)) throw new Error('Ruta Storage no segura.');
  return value.split('/').map(safeComponent).join('/');
}
async function outsideGit(path) {
  let current = resolve(path);
  while (true) {
    try {
      await lstat(join(current, '.git'));
      throw new Error('No guardar datos privados dentro de un repositorio Git.');
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
async function digest(path) {
  const {createReadStream}=await import('node:fs');
  const h=createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}

/**
 * Requires a new, nonexistent directory outside any git checkout.
 * The supplied storage client is injected so tests cannot contact Supabase.
 * All API operations are read-only (list/download), never remove/upload.
 */
export async function snapshotStorage(storage, requestedRoot, {listLimit=100}={}) {
  if (!storage || typeof storage.from !== 'function') throw new Error('Cliente Storage inválido.');
  if (!Number.isSafeInteger(listLimit) || listLimit < 1 || listLimit > 1000)
    throw new Error('Tamaño de página inválido.');
  const root=resolve(requestedRoot);
  await outsideGit(root);
  await mkdir(root, {recursive:false,mode:0o700});
  const canonical=await realpath(root);
  // Also inspect the canonical path: a parent directory may be a symlink.
  await outsideGit(canonical);
  const counts={};
  const records=[];
  let completed=false;
  try {
    const bucketDirs=join(canonical,'storage');
    await mkdir(bucketDirs,{mode:0o700});
    for(const bucket of REQUIRED_BUCKETS){
      const api=storage.from(bucket);
      if (!api || typeof api.list !== 'function' || typeof api.download !== 'function')
        throw new Error('Cliente Storage sin API de lectura.');
      const base=join(bucketDirs,bucket);
      await mkdir(base,{mode:0o700});
      const folders=[''];
      const visited=new Set();
      const keys=new Set();
      let total=0;
      while(folders.length){
        const prefix=folders.shift();
        if(visited.has(prefix)) throw new Error('Carpeta repetida.');
        visited.add(prefix);
        if(visited.size>100000) throw new Error('Demasiadas carpetas.');
        let offset=0;
        for(;;){
          const {data,error}=await api.list(prefix,{limit:listLimit,offset,sortBy:{column:'name',order:'asc'}});
          if(error || !Array.isArray(data)) throw new Error('No se pudo inventariar Storage (sin copiar archivos).');
          for(const entry of data){
            const name=safeComponent(entry?.name);
            const relative=checkedObjectPath(prefix ? prefix+'/'+name : name);
            // Storage's list() returns id:null for virtual folder entries.
            if(entry.id==null) {
              folders.push(relative);
              continue;
            }
            if(typeof entry.id!=='string' || !entry.id) throw new Error('Tipo de objeto no reconocido.');
            if(keys.has(relative)) throw new Error('Objeto duplicado en inventario remoto.');
            keys.add(relative);
            const dest=join(base,...relative.split('/'));
            const localRelative='storage/'+bucket+'/'+relative;
            await mkdir(dirname(dest),{recursive:true,mode:0o700});
            const {data:blob,error:downloadError}=await api.download(relative);
            if(downloadError || !blob || typeof blob.stream!=='function')
              throw new Error('Descarga privada incompleta; no certificar esta copia.');
            // Never overwrite files; no symlink can be present in a new directory.
            const file= createWriteStream(dest,{flags:'wx',mode:0o600});
            try {
              await pipeline(Readable.fromWeb(blob.stream()),file);
            } catch(err) {
              await rm(dest,{force:true});
              throw new Error('Descarga fallida; copia privada incompleta.');
            }
            const actualSize=(await lstat(dest)).size;
            if (Number.isSafeInteger(entry.metadata?.size) && actualSize!==entry.metadata.size)
              throw new Error('El tamaño descargado no coincide con los metadatos remotos.');
            const sha256=await digest(dest);
            records.push({bucket,path:relative,sha256,size:actualSize});
            total++;
            if(records.length>100000) throw new Error('Máximo permitido de objetos superado.');
          }
          if(data.length<listLimit)break;
          offset+=data.length;
          if(offset>100000)throw new Error('Límite de paginación alcanzado.');
        }
      }
      counts[bucket]=total;
    }
    const audit={
      project_ref:PROJECT_REF,
      downloaded_at_utc:new Date().toISOString(),
      buckets:REQUIRED_BUCKETS.map(id=>({id,object_count:counts[id]})),
      objects:records.sort((a,b)=> {
        const x=a.bucket+'/'+a.path, y=b.bucket+'/'+b.path;
        return x<y?-1:x>y?1:0;
      })
    };
    await writeFile(join(canonical,'storage-download-audit.local.json'),
      JSON.stringify(audit,null,2)+'\n',{flag:'wx',mode:0o600});
    completed=true;
    return {root:canonical,objectCount:records.length,bucketCount:REQUIRED_BUCKETS.length};
  } finally {
    // An incomplete export stays in the private folder for inspection,
    // but never receives a success manifest.
    if(!completed){
      await writeFile(join(canonical,'STORAGE-COPIA-INCOMPLETA.txt'),
        'NO UTILIZAR COMO RESPALDO. Revise y elimine la carpeta privada antes de reintentar.\n',
        {flag:'wx',mode:0o600}).catch(()=>{});
    }
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [,,flag,folder] = process.argv;
  if(flag!=='--download-private-storage' || !folder){
    console.error('Uso: node scripts/recovery/download-private-storage.mjs --download-private-storage <NUEVO_DIRECTORIO_PRIVADO>');
    process.exitCode=2;
  }else{
    try{
      const url=process.env.INMOJCO_SUPABASE_URL;
      const key=process.env.INMOJCO_SERVICE_ROLE_KEY;
      if(url!== 'https://'+PROJECT_REF+'.supabase.co' || !key)
        throw new Error('Configurar URL del proyecto y clave de servicio SOLO en el entorno privado local.');
      // The key is never printed, written to an artifact or sent to GitHub.
      const {createClient}=await import('@supabase/supabase-js');
      const client=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
      const result=await snapshotStorage(client.storage,folder);
      console.log('Descarga local terminada: '+result.objectCount+' objetos en '+result.bucketCount+' buckets.');
      console.log('Todavía NO existe backup de PostgreSQL, cifrado verificado ni restauración real.');
    }catch(error){
      console.error('NO SE CERTIFICA RESPALDO: '+error.message);
      process.exitCode=1;
    }
  }
}
