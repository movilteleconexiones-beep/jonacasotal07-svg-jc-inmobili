import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

const origin = 'https://www.inmojco.com';
const timeout = 20000;

test('INMOJCO live anonymous browser flow (no logins, payments or data writes)', async t => {
  const browser = await chromium.launch({headless:true});
  try {
    await t.test('public / should render an actual storefront, not a catalog error',async()=>{
      const context=await browser.newContext();
      try{
        const page=await context.newPage();
        let catalogSlug='none';
        const rpcStatuses=[];
        let jsExceptionCount=0;
        page.on('pageerror',()=>{jsExceptionCount++;});
        page.on('request',req=>{
          if(new URL(req.url()).pathname.endsWith('/rpc/tenant_public_catalog')){
            try{ catalogSlug=String(req.postDataJSON()?.tenant_slug ?? 'missing').slice(0,80); }
            catch{ catalogSlug='unreadable'; }
          }
        });
        page.on('response',resp=>{
          if(new URL(resp.url()).pathname.endsWith('/rpc/tenant_public_catalog'))rpcStatuses.push(resp.status());
        });
        const response=await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout});
        assert.equal(response?.status(),200);
        try{await page.locator('#inicio').waitFor({state:'visible',timeout:12500});}
        catch{
          const diagnostic={
            catalogSlug,
            rpcStatuses,
            catalogUnavailable:await page.getByText('El catálogo no está disponible para esta inmobiliaria.').isVisible(),
            catalogLoading:await page.getByText('Cargando sitio de la inmobiliaria…').isVisible(),
            authHydrating:await page.getByText('Verificando el acceso a tu inmobiliaria…').isVisible(),
            jsExceptionCount,
          };
          // Public slug + HTTP codes only; never log page body, credentials, tokens or JSON responses.
          console.log('PUBLIC_HOME_DIAG '+JSON.stringify(diagnostic));
          assert.fail('Public home did not render storefront');
        }
        console.log('PASS: public storefront mounted');
      }finally{await context.close();}
    });

    for(const route of ['/app','/?billing=return']){
      await t.test(`private sign-in modal from ${route} (signed out)`,async()=>{
        const context=await browser.newContext();
        try{
          const page=await context.newPage();
          const response=await page.goto(origin+route,{waitUntil:'domcontentloaded',timeout});
          assert.equal(response?.status(),200);
          assert.equal(new URL(page.url()).origin,origin);
          await page.getByRole('heading',{name:'Accede a tu panel INMOJCO'}).waitFor({state:'visible',timeout});
          await page.getByRole('button',{name:'Acceso',exact:true}).click();
          await page.getByRole('heading',{name:'Acceso al sistema'}).waitFor({state:'visible',timeout});
          console.log(`PASS: private sign-in modal works at ${route}`);
        }finally{await context.close();}
      });
    }
  }finally{await browser.close();}
});
