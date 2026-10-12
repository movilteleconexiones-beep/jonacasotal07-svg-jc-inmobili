import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const main=readFileSync(new URL('../src/modules/finance/TenantRentEntry.tsx',import.meta.url),'utf8');
const owner=readFileSync(new URL('../src/modules/finance/OwnerSettlementEntry.tsx',import.meta.url),'utf8');
const deductions=readFileSync(new URL('../src/modules/finance/OwnerDeductionLedger.tsx',import.meta.url),'utf8');
const clients=readFileSync(new URL('../src/modules/contacts/ContactsModule.tsx',import.meta.url),'utf8');
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
  assert.match(clients,/TenantRentEntry/);
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
  assert.match(owner,/\.rpc\('create_owner_draft_statement'/);
  assert.match(main,/request_key:crypto\.randomUUID\(\)/);
  assert.doesNotMatch(main,/\.from\('rent_payments'\)\.update\(/);
  assert.doesNotMatch(main,/WOMPI_PRIVATE_KEY|wompi\./i);
  assert.match(migration,/idempotency_key uuid NOT NULL UNIQUE/);
  assert.match(migration,/WHERE organization_id=target_org AND id=target_payment FOR UPDATE/);
  assert.match(migration,/RAISE EXCEPTION 'Receipt exceeds the recorded pending amount'/);
  assert.match(dashboard,/isPlatformAdmin && <a href="\/super-admin"/);
});
