import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

const origin = 'https://www.inmojco.com';
const timeout = 25000;

test('INMOJCO live browser: anonymous public home and private entry work without payments', async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const contexts = ['/','/app','/?billing=return'];
    for (const route of contexts) {
      // Fresh isolated context: never reuse cookies or a real customer session.
      const context = await browser.newContext();
      const page = await context.newPage();
      const response = await page.goto(origin + route,{waitUntil:'domcontentloaded',timeout});
      assert.equal(response?.status(),200, `Broken route: ${route}`);
      assert.equal(new URL(page.url()).origin, origin);
      if (route === '/') {
        // A missing tenant's public catalog must not break the whole product home.
        await page.locator('#inicio').waitFor({state:'visible',timeout});
        assert.equal(await page.getByText('El catálogo no está disponible para esta inmobiliaria.').isVisible(),false);
        console.log('PASS: unauthenticated storefront is visible on canonical WWW');
      } else {
        await page.getByRole('heading',{name:'Accede a tu panel INMOJCO'}).waitFor({state:'visible',timeout});
        const access = page.getByRole('button',{name:'Acceso',exact:true});
        await access.click();
        await page.getByRole('heading',{name:'Acceso al sistema'}).waitFor({state:'visible',timeout});
        console.log(`PASS: private sign-in modal works at ${route}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
