import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';

/**
 * G03 — Real hosted public browser, no sign-in and no form submission.
 * Never enter PII or assert legal approval from a hyperlink alone.
 * The strict flag checks URL readiness, NOT signed legal adoption.
 */
const origin = 'https://www.inmojco.com';
const slugs = ['sistema-inmobiliario-jco', 'jco-inmodigital-global'];
const requirePublished = process.env.INMOJCO_REQUIRE_POLICY_PUBLISHED === '1';

function assertDocumentUrl(raw, slug) {
  const url = new URL(raw, origin);
  assert.equal(url.protocol, 'https:', slug + ': legal document must be HTTPS');
  assert.ok(!url.username && !url.password, 'No credentials in policy URL');
  assert.notEqual(url.pathname.replace(/\\/+$/, '') || '/', '/', slug + ': homepage is not a policy');
  assert.ok(!/^\\/(?:app|super-admin|login)(?:\\/|$)/i.test(url.pathname),
    slug + ': private application route is not a privacy policy');
  assert.notEqual(url.hostname, 'localhost');
}

test('G03: each hosted agency fails closed without a published data policy', async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const slug of slugs) {
      await t.test(slug, async () => {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        try {
          const page = await context.newPage();
          let submissions = 0;
          page.on('request', request => {
            if (/\\/rpc\\/submit_public_website_lead(?:_once)?(?:\\?|$)/.test(request.url()))
              submissions += 1;
          });

          const response = await page.goto(origin + '/inmobiliaria/' + slug, {
            waitUntil: 'domcontentloaded', timeout: 25000,
          });
          assert.equal(response?.status(), 200);
          await page.locator('#inicio').waitFor({ state: 'visible', timeout: 20000 });
          const section = page.locator('#contacto');
          await section.waitFor({ state: 'visible', timeout: 15000 });

          const policyLinks = section.getByRole('link', {
            name: /política de tratamiento de datos/i,
          });
          const send = section.getByRole('button', { name: /^Enviar consulta a /i });
          const manual = section.getByRole('button', { name: 'Preparar correo de consulta' });
          const unavailable = section.getByText('Contacto temporalmente no disponible', {
            exact: true,
          });
          const published = await policyLinks.count() > 0;

          if (published) {
            assert.equal(await policyLinks.count(), 1, 'Exactly one privacy link');
            assertDocumentUrl(await policyLinks.first().getAttribute('href'), slug);
            assert.ok(await send.isVisible(), 'Live CRM button must require consent');
            const consent = section.locator('input[type="checkbox"][required]');
            assert.equal(await consent.count(), 1);
            assert.equal(await consent.isChecked(), false, 'Consent must not be preselected');
          } else {
            assert.equal(await send.count(), 0, 'No automated CRM button without policy');
            const manualVisible = await manual.count() > 0 && await manual.isVisible();
            const unavailableVisible = await unavailable.count() > 0 && await unavailable.isVisible();
            assert.ok(manualVisible || unavailableVisible,
              'No policy must fall back to manual email or unavailable status');
            assert.equal(await section.locator('input[type="checkbox"][required]').count(), 0,
              'No false consent checkbox without a legal document');
          }

          if (requirePublished) {
            assert.ok(published, 'NO-GO: ' + slug + ' has no real public policy URL');
          }

          assert.equal(submissions, 0, 'This smoke must never create a CRM lead');
          console.log('G03_PUBLIC_PRIVACY ' + slug + ' ' +
            (published ? 'POLICY_URL_CONFIGURED' : 'FAIL_CLOSED_NO_POLICY') +
            (requirePublished ? ' STRICT' : ' SAFETY_ONLY'));
        } finally {
          await context.close();
        }
      });
    }
  } finally {
    await browser.close();
  }
});
