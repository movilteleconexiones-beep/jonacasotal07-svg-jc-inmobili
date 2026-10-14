import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const wizard=read('src/modules/rentals/RentalIntakeWizard.tsx');
const closure=read('src/modules/rentals/RentalContractClosure.tsx');
const owners=read('src/modules/owners/OwnersModule.tsx');
const inventory=read('src/modules/properties/PropertiesModule.tsx');
const trigger=read('supabase/migrations/20261014061000_audited_rental_end_owner_retirement.sql');

test('guided onboarding exposes administrative contract termination with required proof',()=>{
  assert.match(wizard,/Finalizar contrato \/ liberar inmueble/);
  assert.match(wizard,/<RentalContractClosure organizationId=\{organizationId\}/);
  assert.match(closure,/activeMembership\?\.roles\.some\(role=>role.key==='ADMIN'\)/);
  assert.match(closure,/can\(PERMISSIONS\.LEASES_EDIT\)/);
  assert.match(closure,/can\(PERMISSIONS\.PROPERTIES_EDIT\)/);
  assert.match(closure,/handover_confirmed:true/);
  assert.match(closure,/acknowledge_pending_financials:ackFinancials/);
  assert.match(closure,/admin_finish_lease_and_release/);
  assert.match(closure,/\.in\('status',\['ACTIVE','RENEWAL'\]\)/);
  assert.match(closure,/physical handover|entregó físicamente el inmueble/i);
});

test('owner withdrawal is an admin action; source and financial records remain intact',()=>{
  assert.match(owners,/Retirar de la inmobiliaria/);
  assert.match(owners,/activeMembership\?\.roles\.some\(role=>role.key==='ADMIN'\)/);
  assert.match(owners,/can\(PERMISSIONS\.OWNERS_EDIT\)/);
  assert.match(owners,/can\(PERMISSIONS\.PROPERTIES_EDIT\)/);
  assert.match(owners,/admin_retire_owner_agency/);
  assert.match(owners,/agency_status==='ACTIVE'/);
  assert.match(owners,/agency_status==='RETIRED'/);
  assert.doesNotMatch(closure,/\.from\('rent_payments'\)\.update\(/);
  assert.doesNotMatch(owners,/\.from\('property_ownerships'\)\.delete\(/);
  assert.doesNotMatch(owners,/\.from\('property_owners'\)\.delete\(/);
});

test('inventory reflects a live active contract, never merely a stale property AVAILABLE flag',()=>{
  assert.match(inventory,/occupiedPropertyIds\.has\(row\.id\)\?'Arrendado · contrato activo'/);
  assert.match(inventory,/\.in\('status',\['ACTIVE','RENEWAL'\]\)/);
  assert.match(inventory,/lease-finished/);
  assert.match(inventory,/owner-agency-retired/);
});

test('server transitions are permission guarded and fully audited',()=>{
  for(const procedure of ['admin_finish_lease_and_release','admin_retire_owner_agency',
    'guard_lease_lifecycle_transition','guard_owner_agency_retirement']){
    assert.ok(trigger.includes(procedure),procedure);
  }
  assert.match(trigger,/is_rental_lifecycle_admin/);
  assert.match(trigger,/lease\.finished/);
  assert.match(trigger,/owner\.agency_retired/);
  assert.match(trigger,/pending_financials_acknowledged/);
  assert.match(trigger,/old.status.*ACTIVE/i);
  assert.match(trigger,/NEW\.agency_status='RETIRED'/);
  assert.match(trigger,/status='INACTIVE'/);
  assert.doesNotMatch(trigger,/DELETE FROM public\.leases|DELETE FROM public\.rent_payments|DELETE FROM public\.owner_statements/);
});
