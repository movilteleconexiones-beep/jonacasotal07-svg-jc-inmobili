import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const origin = 'https://www.inmojco.com';
const approved = JSON.parse(readFileSync(
  new URL('../../security/legal/approved-policy-publication.json', import.meta.url), 'utf8'
)).policies;

const browser = await chromium.launch({ headless: true });
try {
  for (const width of [360, 390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 }, serviceWorkers: 'block'
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', () => errors.push('runtime error'));
      const response = await page.goto(origin + '/', {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      assert.equal(response?.status(), 200);
      assert.equal(new URL(page.url()).origin, origin);
      const seller = page.getByRole('region', { name: 'Identificación y contacto del proveedor de licencias' });
      await seller.waitFor({ state: 'visible', timeout: 20000 });
      await seller.scrollIntoViewIfNeeded();
      for (const text of ['Proveedor de licencias:', 'NIT:', 'Dirección para notificaciones comerciales:', 'Atención y PQR:', 'Facturación:']) {
        assert.ok(await seller.getByText(text, { exact: false }).first().isVisible(), 'Seller field missing');
      }
      const pqr = seller.getByText('Atención y PQR:', { exact: false }).first().locator('a');
      assert.match(await pqr.getAttribute('href') || '', /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/, 'PQR mail link absent');
      const box = await seller.boundingBox();
      assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, 'Seller section exceeds viewport');
      for (const key of ['operador-inmojco', 'terminos-saas-jco']) {
        const path = '/politicas/' + key + '.pdf';
        const link = seller.locator('a[href="' + path + '"]');
        assert.equal(await link.count(), 1);
        assert.ok(await link.isVisible());
        const doc = await context.request.get(origin + path, { timeout: 20000 });
        assert.equal(doc.status(), 200);
        assert.match(doc.headers()['content-type'] || '', /application\/pdf/i);
        const body = await doc.body();
        assert.equal(createHash('sha256').update(body).digest('hex'), approved[key].pdf_sha256, 'Approved PDF hash mismatch: ' + key);
      }
      const sic = page.locator('a[href="https://www.sic.gov.co/"]');
      assert.ok(await sic.first().isVisible(), 'SIC link missing');
      assert.equal(errors.length, 0, 'Page runtime error');
      console.log('PASS G24 hosted seller + PQR link + SIC + exact approved PDFs at viewport ' + width);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
