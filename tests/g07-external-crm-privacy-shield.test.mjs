import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('unapproved external agency must not render a PII collection form, even when it publishes email',()=>{
  assert.match(app, /!automaticContactEnabled && \(Boolean\(tenantSlug\) \|\| !contactFallbackEmail\)/);
  assert.match(app, /Contacto temporalmente no disponible/);
  assert.match(app, /No solicitaremos tus datos a través de este formulario/);

  const hiddenBranch=app.indexOf('!automaticContactEnabled && (Boolean(tenantSlug) || !contactFallbackEmail)');
  const startForm=app.indexOf('<form onSubmit={handleContactSubmit}',hiddenBranch);
  assert.ok(hiddenBranch>0 && startForm>hiddenBranch,
    'PII form must remain behind a tenant-specific availability check');
  const hiddenContent=app.slice(hiddenBranch,startForm);
  assert.doesNotMatch(hiddenContent,/id="c-name"|id="c-email"|id="c-phone"/,
    'unapproved portal must never ask name, email or phone');
});

test('approved personal tenant form still requires an unchecked privacy consent',()=>{
  assert.match(app,/const automaticContactEnabled = Boolean\(tenantSlug && privacyPolicyUrl\)/);
  assert.match(app,/type="checkbox" required checked=\{contactConsent\}/);
  assert.match(app,/href=\{privacyPolicyUrl \|\| '#'\}/);
  assert.match(app,/submit_public_website_lead_once/);
});
