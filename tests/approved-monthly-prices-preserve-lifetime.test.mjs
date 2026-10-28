import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const sql=readFileSync(new URL('../supabase/migrations/20261015074000_approved_monthly_prices_preserve_lifetime.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/modules/billing/BillingModule.tsx',import.meta.url),'utf8');
const terms=readFileSync(new URL('../docs/legal/software-license-terms-v1.md',import.meta.url),'utf8');

test('exact monthly COP tariffs are approved and enforced without other writes',()=>{
  assert.match(sql,/WHEN 'BASIC' THEN 129900/);
  assert.match(sql,/WHEN 'PRO' THEN 299900/);
  assert.match(sql,/currency='COP'/);
  assert.match(sql,/currency='USD' AND basic.price=0/);
  assert.match(sql,/professional.currency='USD' AND professional.price=0/);
  assert.match(sql,/Catalog changed unexpectedly: manual review required/);
  assert.doesNotMatch(sql,/UPDATE\s+public\.(subscriptions|payment_orders|organization_licenses|billing_activation_settings|organization_members)/i);
  assert.doesNotMatch(sql,/INSERT\s+INTO\s+public\.payment_orders/i);
});

test('existing permanent license cannot be re-priced or changed by monthly catalog update',()=>{
  assert.match(sql,/WHERE code='LIFETIME' FOR SHARE/);
  assert.match(sql,/vitalicia.billing_cycle <> 'ONE_TIME'/);
  assert.match(sql,/Lifetime plan must remain untouched/);
  assert.match(sql,/WHERE code IN \('BASIC','PRO'\)/);
  assert.doesNotMatch(sql,/THEN [0-9]+\s*WHEN 'LIFETIME'/);
});

test('checkout offers only recurring Basic and Pro plans, not historical contracts',()=>{
  assert.match(ui,/\.eq\('billing_cycle', 'MONTHLY'\)/);
  assert.match(ui,/\.eq\('currency', 'COP'\)/);
  assert.match(ui,/\.in\('code', \['BASIC', 'PRO'\]\)/);
  assert.doesNotMatch(ui,/INMOJCO Vitalicio|lifetimeAvailable|Precio vitalicio pendiente/);
  assert.match(ui,/No se pudo iniciar el pago/);
});

test('historical perpetual contracts retain legal protection but are not advertised at checkout',()=>{
  assert.match(terms,/licencia perpetua o de pago único no constituye cesión de derechos de autor/);
  assert.match(terms,/Una licencia perpetua no implica soporte, alojamiento, mantenimiento/);
  assert.match(ui,/no puede revender, sublicenciar ni redistribuir INMOJCO/);
  // A commercial UI change must not rewrite or remove historical license contracts.
  assert.match(sql,/Lifetime plan must remain untouched/);
});
