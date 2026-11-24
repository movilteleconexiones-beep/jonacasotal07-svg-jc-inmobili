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
const expectPersonalApproved = process.env.INMOJCO_EXPECT_G07_PERSONAL_APPROVED === '1';
const requireExternalCrmShield = process.env.INMOJCO_REQUIRE_EXTERNAL_CRM_SHIELD === '1';
const ownSlug = 'jco-inmodigital-global';
const personalPolicyUrl = 'https://www.inmojco.com/politicas/jco-inmodigital-global.pdf';

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

test('G07: own approved intake visible, external unapproved intake remains closed', async t => {
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
          // Before the ACL freeze: HTTP 200 with JSON null. After revocation:
          // HTTP 401/403 is an expected fail-closed response, not a leak.
          // Both must produce the same safe modal without PII inputs.
          const status = response.status();
          assert.ok([200, 401, 403].includes(status),
            slug + ': unexpected intake RPC HTTP status ' + status);
          const site = status === 200 ? await response.json() : null;
          const requiresClosed = slug !== ownSlug || !expectPersonalApproved;
          if (requiresClosed) {
            assert.equal(site, null,
              slug + ': unapproved or intentionally closed intake became visible');
          }
          const modal = page.getByRole('dialog', { name: /Consignar propiedad con/i });
          await modal.waitFor({ state: 'visible', timeout: 15000 });

          const isApproved = !!site && !!approvedDocumentUrl(site.policy_url) &&
            typeof site.policy_version === 'string' && !!site.policy_version.trim();
          if (expectPersonalApproved && slug === ownSlug) {
            assert.equal(status, 200, 'Approved personal intake must respond HTTP 200');
            assert.ok(isApproved, 'G07 personal approved intake must be visible');
            assert.equal(site.policy_url, personalPolicyUrl,
              'Only the approved personal tenant policy may be linked');
            assert.equal(site.policy_version, '1.0');
            assert.equal(site.company_name, 'JCO InmoDigital Global');
          }

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

          // G07 CRM gate: a tenant with no adopted policy must not show
          // even local form fields for name, email or phone. Only the owner
          // agency is permitted to render a consent-enabled contact form.
          if (slug !== ownSlug && requireExternalCrmShield) {
            assert.equal(await page.locator('#c-name').count(), 0,
              'External agency must never request a visitor name');
            assert.equal(await page.locator('#c-email').count(), 0,
              'External agency must never request an email');
            assert.equal(await page.locator('#c-phone').count(), 0,
              'External agency must never request a phone number');
          } else if (expectPersonalApproved) {
            const contactSection = page.locator('#contacto');
            await contactSection.waitFor({ state: 'visible', timeout: 15000 });
            await contactSection.locator('#c-name').waitFor({ state: 'visible', timeout: 12000 });
            assert.equal(await contactSection.locator('#c-email').count(), 1);
            assert.equal(await contactSection.locator('#c-phone').count(), 1);
            const consent = contactSection.locator('input[type="checkbox"][required]');
            assert.equal(await consent.count(), 1);
            assert.equal(await consent.isChecked(), false);
            const approvedLink = contactSection.getByRole('link', {
              name: /política de tratamiento de datos/i,
            });
            assert.equal(await approvedLink.getAttribute('href'), personalPolicyUrl);
          }

          assert.equal(submissions, 0, 'Smoke test must not create a consignment');
          assert.equal(photoUploads, 0, 'Smoke test must not upload any photos');
          console.log('G07_HOSTED_INTAKE ' + slug + ' ' +
            (isApproved ? 'POLICY_DOCUMENT_CONFIGURED' : 'FAIL_CLOSED_NO_APPROVAL') +
            (requiresClosed ? ' STRICT_EXTERNAL_CLOSED' : ' STRICT_PERSONAL_APPROVED'));
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
