/**
 * G16: actual browser sessions, real Supabase Auth JWT, test-only tenant.
 * Opt-in from finance96-run-auth.mjs after it creates 5 independent Auth users.
 * Builds a fresh local frontend pointed ONLY to the restored QA Supabase clone.
 * Never operates the public production UI, submits customers, or charges money.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const CLONE='https://zjgstfgiirgjssnihaam.supabase.co';
const LOCAL='http://127.0.0.1:4173';
const AGENT_ROLES=[
  ['ORGANIZATION_OWNER','OWNER'],
  ['ADMIN','ADMIN'],
  ['MANAGER','MANAGER'],
  ['AGENT','AGENT'],
  ['CLIENT','CLIENT'],
];
const DENIED = new Set(['MANAGER','AGENT','CLIENT']);
const operationalButtons=['Propiedades','Clientes','Agenda','Negocios','Propietarios','Documentos'];
const publicOther='/inmobiliaria/jco-inmodigital-global';

function requireEnv(key){
 const value=process.env[key]?.trim();
 assert.ok(value,'G16 missing protected QA environment '+key);
 return value;
}
async function signIn(page,email,password){
 const r=await page.goto(LOCAL+'/app',{waitUntil:'domcontentloaded',timeout:25_000});
 assert.equal(r?.status(),200,'Local QA preview not serving /app');
 await page.getByRole('heading',{name:'Accede a tu panel INMOJCO'})
   .waitFor({state:'visible',timeout:25_000});
 await page.getByRole('button',{name:'Acceso',exact:true}).click();
 await page.getByRole('heading',{name:'Acceso al sistema'})
   .waitFor({state:'visible',timeout:15_000});
 const form=page.locator('form').filter({has:page.locator('input[type=password]')}).first();
 await form.getByLabel('Correo',{exact:true}).fill(email);
 await form.getByLabel('Contraseña',{exact:true}).fill(password);
 await form.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
}

const enabled=process.env.JCO_QA96_RUN_BROWSER==='1';
test('G16 five genuine private-browser role journeys against restored QA clone', {
 skip:enabled?false:'Opt-in gated QA browser must never be claimed as run by default',
},async t=>{
 assert.equal(process.env.JCO_QA96_PROVISION,'1','Only the ephemeral QA Auth provisioner may execute this test');
 assert.equal(new URL(requireEnv('JCO_QA96_SUPABASE_URL')).origin,CLONE,'Clone-only guard');
 assert.equal(new URL(requireEnv('JCO_QA96_BROWSER_ORIGIN')).origin,LOCAL,'Local browser-only guard');
 const {chromium}=await import('playwright');
 const browser=await chromium.launch({headless:true});
 try{
  for(const [role,suffix] of AGENT_ROLES){
   await t.test('real JWT UI role '+role,async()=>{
    const context=await browser.newContext({
      viewport:{width:1280,height:800},serviceWorkers:'block',
      acceptDownloads:false,
    });
    const page=await context.newPage();
    const violations=[],uncaught=[];
    page.on('pageerror',e=>uncaught.push(e.name));
    // Abort any unexpected request BEFORE it leaves the QA browser. A passive
    // request observer notices exfiltration only after it may have happened.
    // This QA preview deliberately allows only localhost and the CLONE API.
    // No production, tracking/telemetry, payment gateway or third-party host.
    await context.route('**/*',route=>{
      const req=route.request();
      let u;
      try{u=new URL(req.url());}
      catch{
        violations.push('Invalid request URL');
        return route.abort('blockedbyclient');
      }
      if(u.origin!==LOCAL && u.origin!==CLONE){
        violations.push('Blocked unexpected network origin');
        return route.abort('blockedbyclient');
      }
      if(u.origin===CLONE && req.method()!=='GET' && req.method()!=='OPTIONS'){
        const protectedRoutes=[
          '/rpc/billing_admin_action','/rpc/platform_set_subscription',
          '/rpc/process_verified_payment_event','/rpc/admin_record_owner_payout',
          '/rpc/record_tenant_rent_receipt','/rpc/submit_public_website_lead',
          '/functions/v1/wompi','/storage/v1/object/',
        ];
        if(protectedRoutes.some(path=>u.pathname.includes(path))){
          violations.push('Forbidden mutation '+u.pathname.slice(0,90));
          return route.abort('blockedbyclient');
        }
      }
      return route.continue();
    });
    try{
     const email=requireEnv('JCO_QA96_'+suffix+'_EMAIL');
     const password=requireEnv('JCO_QA96_'+suffix+'_PASSWORD');
     await signIn(page,email,password);
     if(role==='CLIENT'){
       await page.getByRole('heading',{name:/Portal privado/})
         .waitFor({state:'visible',timeout:25_000});
       assert.equal(await page.getByRole('navigation',{name:'Módulos del sistema'}).count(),0,
        'Client gained an operational module sidebar');
       assert.equal(await page.getByRole('link',{name:/Superadministrador/}).count(),0);
       console.log('G16_REAL_AUTH CLIENT private-only PASS');
     }else{
       const menu=page.getByRole('navigation',{name:'Módulos del sistema'});
       await menu.waitFor({state:'visible',timeout:25_000});
       assert.equal(await page.getByRole('link',{name:/Superadministrador/}).count(),0,
        'An ordinary QA tenant gained platform access');
       for(const label of operationalButtons){
         const btn=menu.getByRole('button',{name:label,exact:true});
         await btn.waitFor({state:'visible',timeout:15_000});
         assert.equal(await btn.isEnabled(),true,role+' cannot access allowed module '+label);
         await btn.click();
         await page.locator('main').first().waitFor({state:'visible',timeout:15_000});
       }
       const userMenu=menu.getByRole('button',{name:'Usuarios',exact:true});
       const financial=menu.getByRole('button',{name:'Comisiones',exact:true});
       if(DENIED.has(role)){
        assert.equal(await menu.getByRole('button',{name:'Nueva vinculación',exact:true}).count(),0,
         role+' unexpectedly sees lease authoring');
        if(role==='AGENT'){
          assert.equal(await financial.count(),0,'Agent must not have commission operations');
          assert.equal(await userMenu.count(),0,'Agent must not see user management');
        }
       }else{
        // Management items are inside the existing collapsed secondary menu.
        await menu.locator('summary').filter({hasText:'Administración y ajustes'}).click();
        await userMenu.waitFor({state:'visible',timeout:15_000});
        assert.equal(await userMenu.isEnabled(),true);
        await menu.getByRole('button',{name:'Nueva vinculación',exact:true})
          .waitFor({state:'visible',timeout:15_000});
       }
       console.log('G16_REAL_AUTH '+role+' operational menu traversal PASS');
     }
     // Signed-in public route remains public and MUST use the selected site's
     // public brand, not leak the QA user or internal sidebar.
     const pub=await page.goto(LOCAL+publicOther,{waitUntil:'domcontentloaded',timeout:25_000});
     assert.equal(pub?.status(),200);
     await page.locator('#inicio').waitFor({state:'visible',timeout:25_000});
     assert.equal(await page.getByRole('navigation',{name:'Módulos del sistema'}).count(),0,
      'Public route displayed signed-in operational sidebar');
     assert.deepEqual(uncaught,[],'Unhandled UI exceptions for '+role);
     assert.deepEqual(violations,[],'Production API request or financial mutation for '+role);
     console.log('G16_REAL_AUTH '+role+' public boundary PASS');
    }finally{await context.close();}
   });
  }
 }finally{await browser.close();}
});
