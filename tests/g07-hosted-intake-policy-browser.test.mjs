import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

/**
 * G07 hosted public HTTP / browser smoke.
 * Reads an anonymous intake RPC from the actual production site but NEVER
 * submits consignment data, photos, names, phones or test customers.
 */
const origin = 'https://www.inmojco.com';
const agencies = ['sistema-inmobiliario-jco', 'jco-inmodigital-global'];
const expectAllClosed = process.env.INMOJCO_EXPECT_ALL_INTAKES_CLOSED === '1';

function approvedDocumentUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = new URL(raw);
    if (value.protocol !== 'https:' || value.username || value.password ||
        !value.pathname || value.pathname === '/' ||
        ['localhost', '127.0.0.1'].includes(value.hostname)) return null;
    return value;
  } catch {
    return null;
  }
}

test('G07: anonymous hosted consignments remain fail-closed without policy approval', async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const slug of agencies) {
      await t.test(slug, async () => {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        try {
          const page = await context.newPage();
          let submissions = 0;
          let photoUploads = 0;
          page.on('request', request => {
            const url = request.url();
            if (/\/rpc\/submit_property_consignment(?:\?|$)/.test(url)) submissions++;
            if (/\/functions\/v1\/consignment-photo-upload(?:\?|$)/.test(url)) photoUploads++;
          });

          const pageResponse = await page.goto(origin + '/inmobiliaria/' + slug, {
            waitUntil: 'domcontentloaded', timeout: 25000,
          });
          assert.equal(pageResponse?.status(), 200, slug + ': portal must be online');
          await page.locator('#inicio').waitFor({ state: 'visible', timeout: 20000 });

          const responsePromise = page.waitForResponse(response =>
            /\/rpc\/get_public_property_intake_site(?:\?|$)/.test(response.url()),
            { timeout: 20000 });
          await page.getByRole('button', { name: 'Consignar Propiedad' }).click();
          const response = await responsePromise;
          assert.equal(response.status(), 200,
            slug + ': anonymous read-only intake RPC must respond without a server error');
          const site = await response.json();
          const modal = page.getByRole('dialog', { name: /Consignar propiedad con/i });
          await modal.waitFor({ state: 'visible', timeout: 15000 });

          if (expectAllClosed) {
            assert.equal(site, null,
              slug + ': NO-GO, a production intake became enabled without legal approval');
          }

          const isApproved = !!site && !!approvedDocumentUrl(site.policy_url) &&
            typeof site.policy_version === 'string' && !!site.policy_version.trim();

          if (!isApproved) {
            await modal.getByText('Recepción de consignaciones temporalmente no disponible', {
              exact: true,
            }).waitFor({ state: 'visible', timeout: 12000 });
            assert.equal(await modal.locator('#owner-name').count(), 0);
            assert.equal(await modal.locator('#owner-phone').count(), 0);
            assert.equal(await modal.locator('#consignment-photos').count(), 0);
            assert.equal(await modal.getByRole('button', { name: 'Enviar consignación' }).count(), 0);
          } else {
            assert.ok(site.slug && site.company_name, 'Active intake must identify its site');
            const link = modal.getByRole('link', { name: /política de tratamiento de datos/i });
            await link.waitFor({ state: 'visible', timeout: 12000 });
            assert.equal(new URL(await link.getAttribute('href')).href,
              approvedDocumentUrl(site.policy_url).href);
            assert.equal(await modal.locator('#owner-name').count(), 1);
            assert.equal(await modal.locator('#owner-phone').count(), 1);
            assert.equal(await modal.locator('#consignment-photos').count(), 1);
            const consent = modal.locator('input[type="checkbox"][required]');
            assert.equal(await consent.count(), 1);
            assert.equal(await consent.isChecked(), false, 'Consent cannot be preselected');
          }

          assert.equal(submissions, 0, 'Smoke test must not create a consignment');
          assert.equal(photoUploads, 0, 'Smoke test must not upload any photos');
          console.log('G07_HOSTED_INTAKE ' + slug + ' ' +
            (isApproved ? 'POLICY_DOCUMENT_CONFIGURED' : 'FAIL_CLOSED_NO_APPROVAL') +
            (expectAllClosed ? ' STRICT_CLOSED' : ' SAFETY_ONLY'));
          await modal.getByRole('button', { name: 'Cerrar', exact: true }).first().click();
        } finally {
          await context.close();
        }
      });
    }
  } finally {
    await browser.close();
  }
});
