import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright';

/**
 * G15 live, non-destructive browser traversal.
 * Production endpoints are limited to GET of pages, read-only public catalog RPC,
 * and browser-local form data. Never sign in, purchase, accept legal terms,
 * create CRM leads, send mail, upload photos or modify financial data.
 */
const ORIGIN = 'https://www.inmojco.com';
const TENANTS = ['sistema-inmobiliario-jco','jco-inmodigital-global'];
const DEVICES = [
 {name:'mobile-360', viewport:{width:360,height:800},isMobile:true,hasTouch:true},
 {name:'mobile-390', viewport:{width:390,height:844},isMobile:true,hasTouch:true},
 {name:'tablet-768',viewport:{width:768,height:1024},isMobile:false,hasTouch:false},
 {name:'desktop-1440',viewport:{width:1440,height:900},isMobile:false,hasTouch:false},
];
const TIMEOUT=25000;
function record(context,page){
 const trace={errors:[],writes:[],protectedAccesses:[]};
 page.on('pageerror',e=>trace.errors.push(e.name));
 page.on('request',r=>{
   const u=new URL(r.url()),method=r.method();
   if(method==='GET'||method==='OPTIONS')return;
   // Catalog RPC is a read-only POST; all other RPC/Storage writes are forbidden.
   if(u.pathname.endsWith('/rpc/tenant_public_catalog'))return;
   const writePaths=['/rpc/submit_','/rpc/record_','/rpc/admin_','/rpc/platform_set_',
    '/rpc/billing_','/rpc/create_','/rpc/reconcile_','/rpc/request_',
    '/functions/v1/consignment','/functions/v1/wompi','/rest/v1/contacts',
    '/rest/v1/leads','/rest/v1/commissions','/rest/v1/leases',
    '/rest/v1/rent_','/rest/v1/organization_members','/storage/v1/object/'];
   if(writePaths.some(path=>u.pathname.includes(path)))
     trace.writes.push(method+':'+u.pathname.slice(0,95));
 });
 return trace;
}
function checkClean(trace,label){
 assert.deepEqual(trace.errors,[],label+': unexpected JavaScript exceptions');
 assert.deepEqual(trace.writes,[],label+': unexpected API mutation from an anonymous probe');
}
async function fixture(browser,device,fn){
 const context=await browser.newContext({
  viewport:device.viewport,isMobile:device.isMobile,hasTouch:device.hasTouch,
  deviceScaleFactor:1,serviceWorkers:'block'
 });
 const page=await context.newPage(),trace=record(context,page);
 try{await fn(page,trace);}finally{await context.close();}
}
async function nav(page,path){
 const response=await page.goto(ORIGIN+path,{waitUntil:'domcontentloaded',timeout:TIMEOUT});
 assert.equal(response?.status(),200,'HTTP for '+path);
 assert.equal(new URL(page.url()).origin,ORIGIN,'unexpected redirect away from canonical hostname');
}
async function publicPortal(page,path){
 await nav(page,path);
 await page.locator('#inicio').waitFor({state:'visible',timeout:TIMEOUT});
 const canonical=await page.locator('link[rel=canonical]').first().getAttribute('href');
 assert.equal(canonical,ORIGIN+path,'wrong canonical for '+path);
 await checkViewport(page,path);
}
async function checkViewport(page,label){
 const widths=await page.evaluate(()=>({
  viewport:document.documentElement.clientWidth,
  scroll:document.documentElement.scrollWidth,
 }));
 if(widths.scroll>widths.viewport+12){
  const offenders=await page.evaluate(()=>[...document.querySelectorAll('body *')]
   .map(el=>{const r=el.getBoundingClientRect();const st=getComputedStyle(el);return {
    tag:el.tagName.toLowerCase(),id:el.id||'',
    cls:typeof el.className==='string'?el.className.slice(0,85):'',
    right:Math.round(r.right),left:Math.round(r.left),
    width:Math.round(r.width),scroll:el.scrollWidth,client:el.clientWidth,
    overflowX:st.overflowX,position:st.position}})
   .filter(v=>v.width>0&&(v.right>document.documentElement.clientWidth+8||
     v.scroll>v.client+10 && v.client>0))
   .sort((a,b)=>(b.scroll-b.client)-(a.scroll-a.client))
   .slice(0,25));
  console.log('G15_GEOMETRY '+JSON.stringify({label,widths,offenders}));
 }
 assert.ok(widths.scroll<=widths.viewport+12,
  label+': horizontal overflow '+JSON.stringify(widths));
}
async function verifyConsignmentClosed(page){
 const button=page.getByRole('button',{name:'Consignar Propiedad',exact:true}).first();
 await button.click();
 const dialog=page.getByRole('dialog',{name:/Consignar propiedad con/i});
 await dialog.waitFor({state:'visible',timeout:TIMEOUT});
 await dialog.getByText('Recepción de consignaciones temporalmente no disponible',{exact:true})
  .waitFor({state:'visible',timeout:TIMEOUT});
 assert.equal(await dialog.locator('#owner-name, #owner-phone, #consignment-photos, input[type=file]').count(),0);
 assert.equal(await dialog.getByRole('button',{name:/enviar|guardar|publicar/i}).count(),0,
  'No intake action must be possible while policies are missing');
 await checkViewport(page,'consignment modal');
 await dialog.getByRole('button',{name:'Cerrar ventana'}).click();
 await dialog.waitFor({state:'hidden',timeout:TIMEOUT});
}

test('G15 all public paths / 4 form factors / access guards (no PII submissions)',async t=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const device of DEVICES){
   for(const slug of ['',...TENANTS]){
    const path=slug?'/inmobiliaria/'+slug:'/';
    await t.test(device.name+' renders '+(slug||'official homepage')+' and catalog',async()=>{
     await fixture(browser,device,async(page,trace)=>{
      await publicPortal(page,path);
      if(!slug) assert.match(await page.title(),/Sistema Inmobiliario JCO/);
      const search=page.getByRole('textbox',{name:'Buscar propiedades'});
      if(await search.count()){
       await search.fill('zz-qa-inexistente-123123');
       assert.equal(await search.inputValue(),'zz-qa-inexistente-123123');
       await search.fill('');
      } else {
       // A tenant may hide its catalog in settings; not a testing failure.
       assert.equal(await page.locator('#catalogo').count(),0,
        'Catalog section visible but search input is inaccessible');
      }
      checkClean(trace,device.name+' '+path);
      console.log('G15_VISIT_PASS '+device.name+' '+path);
     });
    });
   }
   for(const slug of TENANTS){
    const path='/inmobiliaria/'+slug;
    await t.test(device.name+' '+slug+' G07 anonymous intake closed and photo upload inaccessible',async()=>{
     await fixture(browser,device,async(page,trace)=>{
      await publicPortal(page,path);
      await page.locator('#contacto').waitFor({state:'visible',timeout:TIMEOUT});
      await verifyConsignmentClosed(page);
      checkClean(trace,slug+' closed intake');
      console.log('G15_INTAKE_CLOSED '+device.name+' '+slug);
     });
    });
   }
   await t.test(device.name+' private /app and agency-specific entry require authentication',async()=>{
     await fixture(browser,device,async(page,trace)=>{
      for(const path of ['/app','/app?inmobiliaria='+TENANTS[0],'/?billing=return']){
       await nav(page,path);
       await page.getByRole('heading',{name:'Accede a tu panel INMOJCO'})
        .waitFor({state:'visible',timeout:TIMEOUT});
       assert.equal(await page.getByRole('button',{name:'Salir',exact:true}).count(),0);
      }
      await page.getByRole('button',{name:'Acceso',exact:true}).click();
      await page.getByRole('heading',{name:'Acceso al sistema'})
       .waitFor({state:'visible',timeout:TIMEOUT});
      await page.getByRole('button',{name:'Registrarse',exact:true}).click();
      await page.getByRole('heading',{name:'Crear cuenta'})
       .waitFor({state:'visible',timeout:TIMEOUT});
      await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
      await page.getByRole('heading',{name:'Acceso al sistema'})
       .waitFor({state:'visible',timeout:TIMEOUT});
      checkClean(trace,'private routes without login');
      console.log('G15_PRIVATE_LOGIN_GATE '+device.name);
     });
    });
    await t.test(device.name+' /super-admin cannot show management to anonymous visitor',async()=>{
     await fixture(browser,device,async(page,trace)=>{
      await nav(page,'/super-admin');
      await page.getByRole('heading',{name:'Administración central JCO'})
       .waitFor({state:'visible',timeout:TIMEOUT});
      await page.getByText('Acceso restringido a superadministradores autenticados y activos.')
       .waitFor({state:'visible',timeout:TIMEOUT});
      assert.equal(await page.getByRole('button',{name:/suspender acceso|otorgar licencia|eliminar inmobiliaria/i}).count(),0);
      checkClean(trace,'SuperAdmin anonymous denial');
      console.log('G15_PLATFORM_DENIED '+device.name);
     });
    });
    await t.test(device.name+' rejects malformed public tenant URL without falling back to another company',async()=>{
     await fixture(browser,device,async(page,trace)=>{
      await nav(page,'/inmobiliaria/slug-invalido/ruta-extra');
      await page.getByText('La dirección pública de esta inmobiliaria no es válida.')
       .waitFor({state:'visible',timeout:TIMEOUT});
      assert.equal(await page.locator('#inicio').count(),0);
      checkClean(trace,'invalid tenant');
      console.log('G15_INVALID_SLUG_DENIED '+device.name);
     });
    });
  }

  for(const device of DEVICES){
   await t.test(device.name+' does not retain visitor PII when changing tenants in same context',async()=>{
    await fixture(browser,device,async(page,trace)=>{
     await publicPortal(page,'/inmobiliaria/'+TENANTS[0]);
     const form=page.locator('#c-name');
     if(await form.count()){
       // Fictitious, never submitted. A tenant with a lawful inbox may show
       // the local-only preparation form; ensure it resets on tenant change.
       await form.fill('QA NOMBRE FICTICIO');
       await page.locator('#c-email').fill('qa@example.invalid');
       await page.locator('#c-phone').fill('3000000000');
       await page.locator('#c-notes').fill('QA SOLO EN MEMORIA DEL NAVEGADOR');
       await publicPortal(page,'/inmobiliaria/'+TENANTS[1]);
       for(const selector of ['#c-name','#c-email','#c-phone','#c-notes']){
         if(await page.locator(selector).count()){
           assert.equal(await page.locator(selector).inputValue(),'',
             selector+': input data carried to another tenant');
         }
       }
     } else {
       // Both live agencies lack signed privacy policies and a valid contact
       // fallback, so the page must NOT render inputs that collect visitor PII.
       await page.getByText('Contacto temporalmente no disponible',{exact:true})
        .waitFor({state:'visible',timeout:TIMEOUT});
       await publicPortal(page,'/inmobiliaria/'+TENANTS[1]);
       if(await page.locator('#c-name').count()){
         // The second tenant may provide a manual email channel even without
         // a signed policy. The client must show blank preparation fields,
         // never leak the first tenant's data, nor submit a CRM record.
         for(const selector of ['#c-name','#c-email','#c-phone','#c-notes']){
           assert.equal(await page.locator(selector).inputValue(),'',
             'The second tenant inherited data from the first: '+selector);
         }
         await page.getByText(/este formulario no guardará la consulta en el CRM/)
           .waitFor({state:'visible',timeout:TIMEOUT});
       } else {
         await page.getByText('Contacto temporalmente no disponible',{exact:true})
          .waitFor({state:'visible',timeout:TIMEOUT});
         assert.equal(await page.locator('#c-name,#c-email,#c-phone,#c-notes').count(),0);
       }
     }
     checkClean(trace,'tenant data isolation');
     console.log('G15_TENANT_PII_CLEAR '+device.name);
    });
   });
  }
 }finally{await browser.close();}
});
