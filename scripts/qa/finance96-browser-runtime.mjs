/**
 * Protected QA-only local frontend session runner.
 * Existing finance96-run-auth.mjs creates Auth users and handles ALL cleanup.
 * Neither production keys nor service_role keys are forwarded to Vite.
 */
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const LOCAL='http://127.0.0.1:4173';
const CLONE='https://zjgstfgiirgjssnihaam.supabase.co';
const VITE='node_modules/vite/bin/vite.js';
const ROLES=['OWNER','ADMIN','MANAGER','AGENT','CLIENT'];

async function run(argv,env,description){
 const status=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,argv,{
   cwd:ROOT,env,stdio:'inherit',shell:false,
  });
  child.once('error',reject);
  child.once('exit',(code,signal)=>{
   if(signal) reject(Error(description+' stopped by signal'));
   else resolve(code);
  });
 });
 assert.equal(status,0,description+' failed');
}

async function ready(proc,expectedHtml){
 for(let n=0;n<120;n++){
  if(proc.exitCode!==null)throw Error('Local QA preview stopped unexpectedly');
  try{
   const response=await fetch(LOCAL+'/app',{redirect:'manual',signal:AbortSignal.timeout(1000)});
   if(response.status===200){
     const served=await response.text();
     // A different service already occupying 4173 must never receive QA
     // credentials. Strictly match the freshly built index and asset hash.
     assert.equal(served,expectedHtml,'QA preview port is occupied by another frontend');
     return;
   }
  }catch(error){
   if(error?.code==='ERR_ASSERTION')throw error;
   // Preview may still be starting.
  }
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 throw Error('Local QA preview never became ready');
}

export async function runProtectedQaBrowser(env){
 assert.equal(process.env.JCO_QA96_RUN_BROWSER,'1',
  'Browser role tests disabled without explicit operator flag');
 assert.equal(process.env.JCO_QA96_PROVISION,'1','QA provisioner required');
 assert.equal(new URL(env.JCO_QA96_SUPABASE_URL).origin,CLONE,'CLONE ONLY');
 assert.ok(env.JCO_QA96_PUBLISHABLE_KEY,'Missing cloned publishable key');
 for(const suffix of ROLES){
  assert.ok(env['JCO_QA96_'+suffix+'_EMAIL']&&env['JCO_QA96_'+suffix+'_PASSWORD'],
   'Missing ephemeral Auth identity '+suffix);
 }
 // Pass a strict allowlist of PUBLIC inputs to Vite. Never hand it a service
 // key, Wompi variable, PG credentials or any real production secret.
 const publicBuildEnv={
  PATH:process.env.PATH||'',HOME:process.env.HOME||'',
  TMPDIR:process.env.TMPDIR||'/tmp',
  NODE_ENV:'production',
  VITE_SUPABASE_URL:CLONE,
  VITE_SUPABASE_PUBLISHABLE_KEY:env.JCO_QA96_PUBLISHABLE_KEY,
  VITE_PUBLIC_SITE_SLUG:'sistema-inmobiliario-jco',
  VITE_BILLING_TRIAL_LIFETIME_ENABLED:'false',
  VITE_PUBLIC_CRM_IDEMPOTENT:'false',
 };
 await run([VITE,'build'],publicBuildEnv,'QA clone frontend build');
 // Verify build output before accepting any five user credentials.
 const assetNames=readdirSync(join(ROOT,'dist','assets')).filter(name=>name.endsWith('.js'));
 assert.ok(assetNames.length>0,'QA Vite build has no JS assets');
 const publishedJs=assetNames.map(name=>readFileSync(join(ROOT,'dist','assets',name),'utf8')).join('');
 assert.ok(publishedJs.includes(CLONE),'QA bundle does not target the verified cloned project');
 assert.ok(!publishedJs.includes('cuitgyqrjibgwuniapmk'),
   'QA bundle unexpectedly references production Supabase');
 if(env.JCO_QA96_SECRET_KEY)assert.ok(!publishedJs.includes(env.JCO_QA96_SECRET_KEY),
   'PRIVATE QA key accidentally embedded in frontend assets');
 const expectedHtml=readFileSync(join(ROOT,'dist','index.html'),'utf8');

 // Do NOT permit a pre-existing service to impersonate the QA preview.
 // --strictPort fails if 4173 is occupied, and the parsed host is loopback.
 const preview=spawn(process.execPath,[VITE,'preview','--host','127.0.0.1',
  '--port','4173','--strictPort'],{
    cwd:ROOT,env:publicBuildEnv,stdio:['ignore','ignore','ignore'],shell:false,
 });
 let previewError=null;
 preview.on('error',e=>{previewError=e;});
 try{
  await ready(preview,expectedHtml);
  if(previewError)throw previewError;
  const browserEnv={
   PATH:process.env.PATH||'',HOME:process.env.HOME||'',
   TMPDIR:process.env.TMPDIR||'/tmp',
   JCO_QA96_RUN_BROWSER:'1',
   JCO_QA96_PROVISION:'1',
   JCO_QA96_SUPABASE_URL:CLONE,
   JCO_QA96_BROWSER_ORIGIN:LOCAL,
  };
  for(const suffix of ROLES){
   browserEnv['JCO_QA96_'+suffix+'_EMAIL']=env['JCO_QA96_'+suffix+'_EMAIL'];
   browserEnv['JCO_QA96_'+suffix+'_PASSWORD']=env['JCO_QA96_'+suffix+'_PASSWORD'];
  }
  await run(['--test','tests/g16-private-five-role-browser-qa.test.mjs'],
    browserEnv,'Five role authenticated Chromium journeys');
  console.log('G16 BROWSER: five independent Auth sessions checked on local clone UI');
 }finally{
  // Browser and preview terminate BEFORE the existing runner deletes Auth
  // users/PDF fixtures, including on exception or failed assertions.
  if(preview.exitCode===null){
   preview.kill('SIGTERM');
   await Promise.race([
    new Promise(resolve=>preview.once('exit',resolve)),
    new Promise(resolve=>setTimeout(resolve,1600)),
   ]);
   if(preview.exitCode===null)preview.kill('SIGKILL');
  }
 }
}
