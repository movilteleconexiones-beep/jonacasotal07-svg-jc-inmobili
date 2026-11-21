import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const identity = readFileSync(new URL('../src/components/SoftwareSellerIdentity.tsx', import.meta.url), 'utf8');

test('G24 - root portal identifies true SaaS seller and gives working contact channels', () => {
  for (const item of ['Jonathan Castaño Otalvaro', '1017182843-5', 'Guarne, Antioquia', 'VTE GUARNE - AEROPUERTO', '+57 323 522 8591']) {
    assert.ok(identity.includes(item), item);
  }
  for (const email of ['contacto@inmojco.com', 'soporte@inmojco.com', 'privacidad@inmojco.com', 'facturacion@inmojco.com']) {
    assert.ok(identity.includes('mailto:' + email), email);
  }
  assert.match(identity, /tel:\+573235228591/);
});

test('G24 - seller identity does not claim ownership of other agencies', () => {
  assert.match(app, /!tenantSlug && <SoftwareSellerIdentity \/>/);
  assert.match(app, /tenantSlug \? publicCompanyName : softwareBrand/);
  assert.match(app, /Las publicaciones, servicios y datos comerciales son responsabilidad de/);
  assert.doesNotMatch(identity, /service_role|password|secret|WOMPI|authorization.*token/i);
});

test('G24 - central footer retains independent consumer authority link', () => {
  assert.match(app, /https:\/\/www\.sic\.gov\.co\//);
  assert.match(app, /Derechos del consumidor · SIC/);
  assert.match(app, /Proveedor de licencias SaaS/);
});

test('G07 - links to exact approved legal PDF routes are accessible from seller identity', () => {
  assert.match(identity, /href="\/politicas\/operador-inmojco\.pdf"/);
  assert.match(identity, /href="\/politicas\/terminos-saas-jco\.pdf"/);
  assert.match(identity, /rel="noopener noreferrer"/);
  // The vendor block is not the controller of an unrelated agency.
  assert.doesNotMatch(identity, /href="\/politicas\/jco-inmodigital-global\.pdf"/);
});
