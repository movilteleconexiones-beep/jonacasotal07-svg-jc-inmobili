import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';

/**
 * G11 release gate: real mobile Chromium browsing against the official domain.
 * Anonymous / read-only; no login, fake customer, photo, license or payment.
 * This test intentionally fails closed until legally approved intake is live.
 */
const ORIGIN='https://www.inmojco.com';
const SLUGS=['sistema-inmobiliario-jco','jco-inmodigital-global'];
const opts={viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,
  serviceWorkers:'block'};
const TIMEOUT=25000;

async function mobilePage(browser){
 const context=await browser.newContext(opts);
 const page=await context.newPage();
 const events={exceptions:[],submissions:0,uploads:0};
 page.on('pageerror',error=>events.exceptions.push(error.name));
 page.on('request',request=>{
  const url=request.url();
  if(/\/rpc\/(?:submit_public_website_lead(?:_once)?|submit_property_consignment)(?:\?|$)/.test(url)
    && request.method()!=='OPTIONS') events.submissions++;
  if(/\/functions\/v1\/consignment-photo-upload(?:\?|$)/.test(url)) events.uploads++;
 });
 return {context,page,events};
}

async function openPortal(page,path){
 const response=await page.goto(ORIGIN+path,{waitUntil:'domcontentloaded',timeout:TIMEOUT});
 assert.equal(response?.status(),200,path+': expected 200 from published site');
 assert.equal(new URL(page.url()).origin,ORIGIN,'Canonical host changed');
 await page.locator('#inicio').waitFor({state:'visible',timeout:TIMEOUT});
 if(process.env.INMOJCO_PR_CSS_SIMULATION==='1'){
   // PR on production: simulate ONLY the two CSS fixes. This tests geometry
   // while published prod is still old. Strict proof occurs on main after deploy.
   await page.addStyleTag({content:`@media (max-width: 639px) {
     #calculadora [role="tablist"] { display:grid !important; width:100% !important;
       min-width:0 !important; grid-template-columns:minmax(0,1fr) !important; gap:.25rem; }
     header div.shrink-0 { width:100% !important; min-width:0 !important;
       max-width:100% !important; justify-content:flex-start !important; flex-wrap:wrap !important; }
   }`});
 }
 const width=await page.evaluate(()=>({
   viewport:document.documentElement.clientWidth,
   scroll:document.documentElement.scrollWidth,
 }));
 if(width.scroll-width.viewport>12){
  // Visual geometry only: do NOT print DOM text, inputs, PII or user content.
  const culprits=await page.evaluate(()=>{
   const viewport=document.documentElement.clientWidth;
   return [...document.querySelectorAll('body *')].map(el=>{
    const rect=el.getBoundingClientRect();
    return {tag:el.tagName.toLowerCase(),id:el.id||undefined,
     cls:typeof el.className==='string' ? el.className.slice(0,105) : '',
     x:Math.round(rect.left),right:Math.round(rect.right),
     width:Math.round(rect.width),position:getComputedStyle(el).position};
   }).filter(x=>x.right>viewport+12&&x.width>0)
     .sort((a,b)=>b.right-a.right).slice(0,24);
  });
  console.log('G11_MOBILE_OVERFLOW_DIAG '+JSON.stringify({path,width,culprits}));
 }
 assert.ok(width.scroll-width.viewport<=12,
  path+': horizontal overflow on 390px viewport (viewport='+width.viewport+', scroll='+width.scroll+')');
}

test('G11 source releases matching mobile fixes, not a global overflow hide',()=>{
 const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
 const simulator=readFileSync(new URL('../src/components/PatrimonialSimulator.tsx',import.meta.url),'utf8');
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(app,/flex w-full min-w-0 max-w-full flex-wrap items-center justify-start/);
 assert.match(simulator,/grid w-full min-w-0 grid-cols-1 gap-1 p-1/);
 assert.match(simulator,/sm:inline-flex sm:w-auto/);
 assert.ok(html.includes('<link rel="canonical" href="https://www.inmojco.com/" />'));
 assert.ok(app.includes("document.querySelector<HTMLLinkElement>('link[rel=\"canonical\"]')"));
 assert.ok(app.includes('tenantPublicPath(tenantSlug)'));
 assert.doesNotMatch(app,/overflow-x-hidden|overflow-hidden.*inicio/);
});

test('G11: official mobile site and two agencies render without leaking customer information',async t=>{
 const browser=await chromium.launch({headless:true});
 try{
  await t.test('mobile home and commercial canonical identity',async()=>{
   const {context,page,events}=await mobilePage(browser);
   try{
    await openPortal(page,'/');
    assert.match(await page.title(),/Sistema Inmobiliario JCO/);
    const candidate=page.locator('link[rel=canonical]');
    const canonical=await candidate.count() ? await candidate.first().getAttribute('href') : null;
    // PR verifies CSS overlay against the older published build;
    // main/push must verify real canonical metadata without overlays.
    if(process.env.INMOJCO_PR_CSS_SIMULATION==='1'){
      assert.ok(canonical===null||canonical===ORIGIN+'/');
    } else assert.equal(canonical,ORIGIN+'/');
    assert.deepEqual(events.exceptions,[],'Unhandled JavaScript errors on mobile home');
    assert.equal(events.submissions,0);
    console.log('G11_MOBILE home PASS no-overflow no-PII 390px');
   }finally{await context.close();}
  });
  for(const slug of SLUGS){
   await t.test('mobile agency '+slug+' keeps public intake fail-closed',async()=>{
    const {context,page,events}=await mobilePage(browser);
    try{
     await openPortal(page,'/inmobiliaria/'+slug);
     if(process.env.INMOJCO_PR_CSS_SIMULATION!=='1'){
       const agencyCanonical=await page.locator('link[rel=canonical]').first().getAttribute('href');
       assert.equal(agencyCanonical,ORIGIN+'/inmobiliaria/'+slug);
     }
     await page.locator('#contacto').waitFor({state:'visible',timeout:15000});
     await page.getByRole('button',{name:'Consignar Propiedad',exact:true}).first().click();
     const dialog=page.getByRole('dialog',{name:/Consignar propiedad con/i});
     await dialog.waitFor({state:'visible',timeout:15000});
     await dialog.getByText('Recepción de consignaciones temporalmente no disponible',{exact:true})
       .waitFor({state:'visible',timeout:15000});
     assert.equal(await dialog.locator('#owner-name, #owner-phone, #consignment-photos').count(),0,
       'PII fields must not render without a verified policy');
     assert.deepEqual(events.exceptions,[],'Unhandled mobile JavaScript error');
     assert.equal(events.submissions,0,'Smoke must never submit contact/consignment PII');
     assert.equal(events.uploads,0,'Smoke must never upload photos');
     console.log('G11_MOBILE '+slug+' PASS no-overflow fail-closed no-PII 390px');
    }finally{await context.close();}
   });
  }
 }finally{await browser.close();}
});

test('G11: signed-out mobile private route never bypasses access screen',async()=>{
 const browser=await chromium.launch({headless:true});
 const {context,page,events}=await mobilePage(browser);
 try{
  const response=await page.goto(ORIGIN+'/app',{waitUntil:'domcontentloaded',timeout:TIMEOUT});
  assert.equal(response?.status(),200);
  await page.getByRole('heading',{name:'Accede a tu panel INMOJCO'})
    .waitFor({state:'visible',timeout:TIMEOUT});
  assert.deepEqual(events.exceptions,[]);
  assert.equal(events.submissions,0);
  console.log('G11_MOBILE private route PASS login-required');
 }finally{await context.close();await browser.close();}
});
