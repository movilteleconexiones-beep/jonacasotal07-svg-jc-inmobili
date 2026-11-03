import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {localDateISO,localMonthISO} from '../src/core/local-calendar.ts';
import {parseMoneyInput} from '../src/core/rent-owner-money.ts';

const main=readFileSync(new URL('../src/modules/finance/TenantRentEntry.tsx',import.meta.url),'utf8');
const owner=readFileSync(new URL('../src/modules/finance/OwnerSettlementEntry.tsx',import.meta.url),'utf8');
const deductions=readFileSync(new URL('../src/modules/finance/OwnerDeductionLedger.tsx',import.meta.url),'utf8');
const clients=readFileSync(new URL('../src/modules/contacts/ContactsModule.tsx',import.meta.url),'utf8');
const wizard=readFileSync(new URL('../src/modules/rentals/RentalIntakeWizard.tsx',import.meta.url),'utf8');
const owners=readFileSync(new URL('../src/modules/owners/OwnersModule.tsx',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../src/modules/dashboard/PrivateDashboard.tsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261012130000_rent_receipts_and_owner_drafts.sql',import.meta.url),'utf8');

test('all income, expense and deduction entry controls are rendered before any business record exists',()=>{
  for(const caption of ['Nuevo contrato','Crear cobro mensual','Registrar abono','Canon mensual','Importe recibido'])
    assert.ok(main.includes(caption),caption);
  for(const caption of ['Crear liquidación del propietario','Comisión inmobiliaria','Impuestos / retenciones'])
    assert.ok(owner.includes(caption),caption);
  for(const caption of ['Registrar deducción','responsible_party','support_reference','Aprobar','Anular'])
    assert.ok(deductions.includes(caption),caption);
  assert.doesNotMatch(clients,/<TenantRentEntry/);
  assert.match(wizard, /mode="DRAFT"/);
  assert.match(wizard, /mode="BILLING"/);
  assert.match(owners,/OwnerSettlementEntry/);
  assert.match(owners,/OwnerDeductionLedger/);
});

test('organization and permission gates apply to every input and receipt route',()=>{
  assert.match(main,/can\(PERMISSIONS\.LEASES_CREATE\)/);
  assert.match(main,/can\(PERMISSIONS\.RENT_PAYMENTS_CREATE\)/);
  assert.match(owner,/can\(PERMISSIONS\.OWNER_STATEMENTS_CREATE\)/);
  assert.match(deductions,/can\(PERMISSIONS\.OWNER_STATEMENTS_CREATE\)/);
  for(const text of [main,owner,deductions]) assert.match(text,/\.eq\('organization_id',organizationId\)/);
  assert.match(migration,/has_org_permission\(target_org,'rent_payments\.create'\)/);
  assert.match(migration,/has_org_permission\(target_org,'owner_statements\.create'\)/);
  assert.match(migration,/FOREIGN KEY \(organization_id,rent_payment_id\)/);
  assert.match(migration,/UNIQUE \(organization_id,lease_id,period_month\)/);
  assert.match(migration,/REVOKE INSERT, UPDATE, DELETE ON public\.rent_payments/);
});

test('abonos use atomic audited server functions, no client-side aggregate edits or Wompi',()=>{
  assert.match(main,/\.rpc\('create_tenant_rent_period'/);
  assert.match(main,/\.rpc\('record_tenant_rent_receipt'/);
  assert.match(owner,/\.rpc\('create_owner_draft_statement_by_percentage'/);
  assert.match(main,/request_key:request\.key/);
  assert.match(main,/pendingReceiptRequest\.current\?\.fingerprint!==fingerprint/);
  assert.doesNotMatch(main,/\.from\('rent_payments'\)\.update\(/);
  assert.doesNotMatch(main,/WOMPI_PRIVATE_KEY|wompi\./i);
  assert.match(migration,/idempotency_key uuid NOT NULL UNIQUE/);
  assert.match(migration,/WHERE organization_id=target_org AND id=target_payment FOR UPDATE/);
  assert.match(migration,/RAISE EXCEPTION 'Receipt exceeds the recorded pending amount'/);
  assert.match(dashboard,/isPlatformAdmin && <a href="\/super-admin"/);
});


test('accounting forms use Colombian local calendar rather than UTC calendar',()=>{
  const previousTZ=process.env.TZ;
  try {
    process.env.TZ='America/Bogota';
    const boundary=new Date('2026-11-01T01:00:00.000Z');
    assert.equal(boundary.toISOString().slice(0,7),'2026-11');
    assert.equal(localMonthISO(boundary),'2026-10');
    assert.equal(localDateISO(boundary),'2026-10-31');
    assert.match(main,/const thisMonth=localMonthISO;/);
    assert.match(owner,/useState\(localMonthISO\(\)\)/);
    assert.match(deductions,/defaultValue=\{localDateISO\(\)\}/);
  } finally {
    if(previousTZ===undefined) delete process.env.TZ;
    else process.env.TZ=previousTZ;
  }
});

test('money precision and server row counts cannot create false financial confirmations',()=>{
  assert.equal(parseMoneyInput('0.29'),0.29);
  assert.equal(parseMoneyInput('120000.50'),120000.5);
  assert.ok(Number.isNaN(parseMoneyInput('1.999')));
  assert.match(deductions,/parseMoneyInput\(form.get\('amount'\)\)/);
  assert.match(main,/\.select\('id'\)\.maybeSingle\(\)/);
  assert.match(deductions,/\.select\('id'\)\.maybeSingle\(\)/);
  assert.match(owner,/can\(PERMISSIONS\.RENT_PAYMENTS_VIEW\)/);
});

test('financial network failures release buttons and retain receipt retry identity',()=>{
  const receipt=main.slice(main.indexOf('async function recordReceipt'),main.indexOf('const active=leases.filter'));
  const failure=receipt.match(/catch\s*\{([\s\S]*?)\}\s*finally\s*\{([\s\S]*?)\}/);
  assert.ok(failure,'receipt must recover from thrown network errors');
  assert.doesNotMatch(failure[1],/pendingReceiptRequest\.current\s*=\s*null|setRevision\(/);
  assert.match(failure[2],/setBusy\(false\)/);
  assert.match(receipt,/request_key:request\.key/);
  for(const method of ['createContract','activateContract','createPeriod']) {
    const section=main.slice(main.indexOf('async function '+method), main.indexOf('async function '+({createContract:'activateContract',activateContract:'createPeriod',createPeriod:'recordReceipt'}[method])));
    assert.match(section,/catch\s*\{/);
    assert.match(section,/finally\s*\{\s*(?:rentMutationInFlight\.current=false;\s*)?setBusy\(false\)/);
  }
  assert.match(owner,/Falló la conexión al consultar contratos y pagos/);
  assert.match(owner,/finally\s*\{\s*if\(!cancelled\) setLoading\(false\)/);
  assert.match(owner,/No se confirmó la creación de la liquidación/);
  assert.match(owner,/finally\s*\{\s*setBusy\(false\)/);
  for(const operation of ['submit','changeStatus','reconcileStatement']) {
    const section=deductions.slice(deductions.indexOf('async function '+operation));
    assert.match(section,/catch\s*\{/);
    assert.match(section,/finally\s*\{\s*setSaving\(false\)/);
  }
});


test('contract draft double-submit lock and database duplicate message',()=>{
  const section=main.slice(main.indexOf('async function createContract('),main.indexOf('async function correctDraft('));
  assert.match(main,/const contractSubmissionInFlight=useRef\(false\)/);
  assert.match(section,/if\(!contractAllowed\|\|busy\|\|contractSubmissionInFlight\.current\|\|rentMutationInFlight\.current\)return/);
  const locked=section.indexOf('contractSubmissionInFlight.current=true');
  const preflight=section.indexOf("await Promise.all(");
  const insert=section.indexOf(".from('leases').insert(");
  assert.ok(locked>0 && locked<preflight && preflight<insert,
    'synchronous lock must precede preflight and insert');
  assert.match(section,/failure\?\.code==='23505'/);
  assert.match(section,/failure\.message\.includes\('leases_one_open_contract_per_property'\)/);
  assert.match(section,/Busca y corrige el existente en lugar de crear otro/);
  const duplicateMessage=section.slice(section.indexOf("failure?.code==='23505'"),section.indexOf('} else {',section.indexOf("failure?.code==='23505'")));
  assert.doesNotMatch(duplicateMessage,/setRevision\(/,'duplicate message must not disappear on a refresh');
  assert.match(section,/finally\s*\{\s*setBusy\(false\);\s*contractSubmissionInFlight\.current=false;\s*rentMutationInFlight\.current=false/);
});

test('all six rent and contract mutations acquire the SAME synchronous lock before awaiting', () => {
  assert.match(main, /const rentMutationInFlight=useRef\(false\)/);

  const boundaries = [
    ['createContract','correctDraft'],
    ['correctDraft','cancelDraft'],
    ['cancelDraft','activateContract'],
    ['activateContract','createPeriod'],
    ['createPeriod','recordReceipt'],
    ['recordReceipt',null],
  ];
  for (const [handler,next] of boundaries) {
    const start=main.indexOf('async function '+handler+'(');
    const stop=next
      ? main.indexOf('async function '+next+'(',start)
      : main.indexOf('const active=leases.filter',start);
    assert.ok(start>=0 && stop>start,'Missing function boundary '+handler);
    const body=main.slice(start,stop);
    const guard=body.indexOf('rentMutationInFlight.current');
    const acquired=body.indexOf('rentMutationInFlight.current=true;',guard);
    const awaited=body.indexOf('await ',acquired);
    const released=body.indexOf('rentMutationInFlight.current=false;',awaited);
    assert.ok(guard>=0 && acquired>guard && awaited>acquired,
      handler+' must guard and acquire before starting the first async operation');
    assert.ok(released>awaited,handler+' must release after the awaited operation');
    assert.match(body,/finally\s*\{[\s\S]*?rentMutationInFlight\.current=false;/,
      handler+' must release the shared lock on all paths, including failure and return');
  }
});

test('fast repeated financial submits are rejected without generating a second receipt request', () => {
  const start=main.indexOf('async function recordReceipt(');
  const end=main.indexOf('const active=leases.filter',start);
  const receipt=main.slice(start,end);
  const earlyGuard=receipt.indexOf('if(!paymentAllowed||busy||rentMutationInFlight.current)return;');
  const requestKey=receipt.indexOf('pendingReceiptRequest.current={fingerprint,key:crypto.randomUUID()}');
  const acquired=receipt.indexOf('rentMutationInFlight.current=true;');
  const upload=receipt.indexOf('await validateRentReceiptEvidence(file)');
  const ledger=receipt.indexOf("await supabase.rpc('record_tenant_rent_receipt'");
  assert.ok(earlyGuard>=0 && earlyGuard<requestKey && requestKey<acquired &&
    acquired<upload && acquired<ledger,
  'second fast event must be rejected BEFORE generating/uploading a receipt');
  assert.match(receipt,/request_key:request\.key/);
  assert.match(receipt,/pendingReceiptRequest\.current=null;/);
  assert.match(receipt,/finally\s*\{\s*rentMutationInFlight\.current=false;\s*setBusy\(false\);/);
});
