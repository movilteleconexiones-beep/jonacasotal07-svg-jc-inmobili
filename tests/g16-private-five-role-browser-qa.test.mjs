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
const ownerDesktopOnly=process.env.JCO_QA96_OWNER_DESKTOP_ONLY==='1';
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
   for(const mobile of [false,true]){
   if(ownerDesktopOnly && (role!=='ORGANIZATION_OWNER'||mobile))continue;
   await t.test('real JWT UI role '+role+(mobile?' mobile':' desktop'),async()=>{
    const context=await browser.newContext({
      viewport:mobile?{width:390,height:844}:{width:1280,height:800},serviceWorkers:'block',
      isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1,
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
      // Fonts are presentation-only. Fulfill the exact known font stylesheet
      // locally without sending any request, cookies or headers externally.
      if(u.origin==='https://fonts.googleapis.com' && u.pathname==='/css2' &&
         req.method()==='GET' && req.resourceType()==='stylesheet'){
        return route.fulfill({status:200,contentType:'text/css',body:''});
      }
      if(u.origin!==LOCAL && u.origin!==CLONE){
        // Log only origin and resource type, never paths, query or credentials.
        const safeOrigin=u.protocol==='https:'||u.protocol==='http:' ? u.origin : u.protocol;
        violations.push('Blocked unexpected network origin '+safeOrigin+' ('+req.resourceType()+')');
        return route.abort('blockedbyclient');
      }
      if(u.origin===CLONE && req.method()!=='GET' && req.method()!=='OPTIONS'){
        const protectedRoutes=[
          '/rpc/billing_admin_action','/rpc/platform_set_subscription',
          '/rpc/process_verified_payment_event','/rpc/admin_record_owner_payout',
          '/rpc/record_tenant_rent_receipt','/rpc/submit_public_website_lead',
          '/functions/v1/wompi','/storage/v1/object/',
          '/rpc/billing_create_order','/functions/v1/billing/checkout','/functions/v1/billing-production/checkout',
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
       if(mobile && !(await menu.isVisible())){
         const toggle=page.getByRole('button',{name:/abrir menú|mostrar menú|menú de navegación/i}).first();
         if(await toggle.count()) await toggle.click();
       }
       if(process.env.JCO_QA24_CHECKOUT_SUMMARY==='1' && ownerDesktopOnly && role==='ORGANIZATION_OWNER'){
         // Expired subscriptions go directly to billing without the operational menu.
         const billingHeading=page.getByRole('heading',{name:'Plan y activación',exact:true});
         await billingHeading.or(menu).first().waitFor({state:'visible',timeout:25000});
         assert.equal(await page.getByRole('link',{name:/Superadministrador/}).count(),0);
         if(!(await billingHeading.isVisible())){
           await menu.locator('summary').filter({hasText:'Administración y ajustes'}).click();
           const license=menu.getByRole('button',{name:'Licencia',exact:true});
           await license.waitFor({state:'visible',timeout:15000});
           await license.click();
           await page.getByRole('button',{name:'Plan y activación',exact:true}).click();
         }
         await billingHeading.waitFor({state:'visible',timeout:25000});
         const plan=page.locator('article').filter({has:page.getByRole('heading',{name:/básico|basico|basic/i,exact:false})}).first();
         const review=plan.getByRole('button',{name:/Simular renovación \(revisar antes\)|Revisar pago Sandbox/});
         await review.waitFor({state:'visible',timeout:20000});
         await review.click({timeout:20000});
         const summary=plan.getByRole('region',{name:/Resumen previo al pago del plan/});
         await summary.waitFor({state:'visible'});
         for(const width of [1280,390]){
           await page.setViewportSize({width,height:844});
           assert.ok(await summary.getByText('Total de la compra',{exact:true}).isVisible());
           assert.match(await summary.innerText(),/149[.\s]900\s*COP/);
           assert.match(await summary.innerText(),/5 usuarios, 200 inmuebles/);
           assert.match(await summary.innerText(),/Mensual/);
           assert.match(await summary.innerText(),/Wompi Sandbox \(sin cobro real\)/);
           const identity=summary.getByRole('region',{name:'Identificación y contacto del proveedor de licencias'});
           assert.ok(await identity.isVisible());
           assert.ok(await identity.getByText('Atención y PQR:',{exact:false}).first().isVisible());
           assert.ok(await summary.locator('a[href="#terminos-licencia"]').isVisible());
           assert.equal(await page.locator('#terminos-licencia').count(),1);
           assert.equal(await summary.locator('a[href="/politicas/operador-inmojco.pdf"]').count(),1);
           assert.equal(await summary.locator('a[href="/politicas/terminos-saas-jco.pdf"]').count(),1);
           const ack=summary.getByRole('checkbox',{name:/He revisado el vendedor/});
           const confirm=summary.getByRole('button',{name:'Confirmar e ir a Wompi Sandbox',exact:true});
           assert.equal(await ack.isChecked(),false);
           assert.equal(await confirm.isEnabled(),false);
           await ack.check();
           assert.equal(await confirm.isEnabled(),true);
           // Do not click confirm. Returning to the plans must reset consent.
           await summary.getByRole('button',{name:'Volver a los planes',exact:true}).click();
           await review.click();
           assert.equal(await ack.isChecked(),false);
           assert.equal(await confirm.isEnabled(),false);
           console.log('G24_CHECKOUT_REAL_AUTH review-only PASS viewport '+width);
         }
         await summary.getByRole('button',{name:'Volver a los planes',exact:true}).click();
         assert.deepEqual(uncaught,[]);
         assert.deepEqual(violations,[]);
         return;
       }
       await menu.waitFor({state:'visible',timeout:25_000});
       assert.equal(await page.getByRole('link',{name:/Superadministrador/}).count(),0,
        'An ordinary QA tenant gained platform access');
       for(const label of operationalButtons){
         const btn=menu.getByRole('button',{name:label,exact:true});
         if(mobile && !(await menu.isVisible())){
           const toggle=page.getByRole('button',{name:/abrir menú|mostrar menú|menú de navegación/i}).first();
           if(await toggle.count()) await toggle.click();
         }
         await btn.waitFor({state:'visible',timeout:15_000});
         // Wait for the actual license/permission guard, not a transient initial render.
         await page.waitForFunction(({label})=>Array.from(document.querySelectorAll('nav[aria-label="Módulos del sistema"] button')).some(b=>b.textContent.trim()===label && !b.disabled),{label},{timeout:25_000});
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
     if (ownerDesktopOnly) {
       assert.deepEqual(uncaught,[],'Unhandled UI exceptions for owner desktop');
       assert.deepEqual(violations,[],'Unexpected network access or mutation');
       return;
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
     if(mobile){
       const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
       assert.ok(dimensions.scroll<=dimensions.width+2,'Mobile public page horizontal overflow');
     }
     console.log('G16_REAL_AUTH '+role+' '+(mobile?'MOBILE':'DESKTOP')+' public boundary PASS');
    }finally{await context.close();}
   });
   }
  }
 }finally{await browser.close();}
});
