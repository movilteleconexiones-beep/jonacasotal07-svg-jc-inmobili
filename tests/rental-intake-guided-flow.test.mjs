import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
const wizard = read('src/modules/rentals/RentalIntakeWizard.tsx');
const rentals = read('src/modules/finance/TenantRentEntry.tsx');
const pdf = read('src/modules/finance/SignedLeaseDocuments.tsx');
const contacts = read('src/modules/contacts/ContactsModule.tsx');
const properties = read('src/modules/properties/PropertiesModule.tsx');
const owners = read('src/modules/owners/OwnersModule.tsx');
const dashboard = read('src/modules/dashboard/PrivateDashboard.tsx');
const sidebar = read('src/core/tenant-menu.ts');
const migration = read('supabase/migrations/20261012180000_guided_rental_intake_admin_approval.sql');

test('six-step rental intake is available for tenant agents and administrators',()=>{
  for(const name of ['Vivienda','Cliente','Contrato','PDF firmado','Aprobación','Cobros'])
    assert.ok(wizard.includes(name),name);
  assert.match(sidebar,/RENTAL_INTAKE.*Nueva vinculación.*LEASES_VIEW/);
  assert.match(dashboard,/<RentalIntakeWizard key=\{organizationId\} organizationId=\{organizationId\}/);
  assert.match(wizard,/<PropertiesModule onCreated=/);
  assert.match(wizard,/<OwnersModule ownersOnly/);
  assert.match(wizard,/<ContactsModule contactsOnly onCreated=/);
  assert.match(wizard,/mode="DRAFT"/);
  assert.match(wizard,/mode="SIGNED_PDF"/);
  assert.match(wizard,/mode="APPROVAL"/);
  assert.match(wizard,/mode="BILLING"/);
  assert.match(wizard,/onDraftCreated=\{id => \{ setLeaseId\(id\); setStep\(3\); \}\}/);
  assert.match(wizard,/onPdfUploaded=\{id => \{ setLeaseId\(id\); setStep\(4\); \}\}/);
  assert.match(wizard,/onActivated=\{id => \{ setLeaseId\(id\); setStep\(5\); \}\}/);
});

test('existing property and customer records are reused without duplicated records or accounting forms',()=>{
  assert.match(properties,/onCreated\?\.\(created\.id\)/);
  assert.match(contacts,/onCreated\?\.\(created\.id\)/);
  assert.match(contacts,/!contactsOnly && organizationId && <TenantRentEntry/);
  assert.match(owners,/!ownersOnly && organizationId && <OwnerSettlementEntry/);
  assert.match(wizard,/Si la vivienda ya figura en el inventario, no la dupliques/);
  assert.match(rentals,/defaultValue=\{preferredPropertyId\|\|''\}/);
  assert.match(rentals,/defaultValue=\{preferredTenantId\|\|''\}/);
  assert.match(rentals,/\.select\('id'\)\.single\(\)/);
});

test('agent receives draft/view only, admin activation requires private signed PDF and no occupied duplicate',()=>{
  assert.match(migration,/permission\.key IN \('leases\.view','leases\.create'\)/);
  assert.match(migration,/admin_permission\.key='leases\.edit'/);
  assert.doesNotMatch(migration,/permission\.key IN \([^)]*leases\.edit/);
  assert.match(migration,/CREATE UNIQUE INDEX leases_one_occupied_contract_per_property/);
  assert.match(migration,/WHERE status IN \('ACTIVE','RENEWAL'\)/);
  assert.match(migration,/OLD\.status <> 'DRAFT' OR NEW\.status <> 'ACTIVE'/);
  assert.match(migration,/role\.key='ADMIN'/);
  assert.match(migration,/has_org_permission\(NEW\.organization_id,'leases\.edit'\)/);
  assert.match(migration,/JOIN storage\.objects file/);
  assert.match(migration,/doc\.entity_type='GENERAL' AND doc\.entity_id=NEW\.id/);
  assert.match(migration,/doc\.storage_bucket='organization-documents'/);
  assert.match(migration,/BEFORE UPDATE OF status ON public\.leases/);
  assert.doesNotMatch(migration,/WOMPI_PRIVATE_KEY|UPDATE public\.rent_payments/);
  assert.match(rentals,/if\(!activationAllowed\|\|busy/);
  assert.match(rentals,/activeMembership\?\.roles\.some\(role=>role\.key==='ADMIN'\)/);
  assert.match(rentals,/canReadRent \? supabase\.from\('rent_payments'\)/);
  assert.match(rentals,/Promise\.resolve\(\{data:\[\] as Period\[\],error:null\}\)/);
  assert.match(rentals,/mode==='APPROVAL'/);
  assert.match(rentals,/Revisé el PDF · Aprobar y activar/);
  assert.match(pdf,/preferredLeaseId\?: string/);
  assert.match(pdf,/onUploaded\?\.\(lease\.id\)/);
});

test('payments remain unavailable until server-side activation',()=>{
  assert.match(rentals,/leases\.some\(l=>l\.id===id&&l\.status==='ACTIVE'\)/);
  assert.match(rentals,/\.rpc\('create_tenant_rent_period'/);
  assert.match(rentals,/\.rpc\('record_tenant_rent_receipt'/);
  assert.match(wizard,/!canCollect/);
});
