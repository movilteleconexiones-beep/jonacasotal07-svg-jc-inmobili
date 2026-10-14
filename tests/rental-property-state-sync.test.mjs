import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

const migration=read('supabase/migrations/20261014071000_sync_rented_property_on_lease_activation.sql');
const legacyClosure=read('supabase/migrations/20261014061000_audited_rental_end_owner_retirement.sql');
const inventory=read('src/modules/properties/PropertiesModule.tsx');
const contracts=read('src/modules/finance/TenantRentEntry.tsx');
const owners=read('src/core/rental-owner-selection.ts');
const onboarding=read('src/modules/rentals/RentalIntakeWizard.tsx');
const fixture=read('security/tests/rental_owner_exit_assertions.sql');

test('only an administrator-approved activation atomically changes property status',()=>{
  assert.match(migration,/AFTER UPDATE OF status ON public\.leases/);
  assert.match(migration,/NEW\.status IN \('ACTIVE','RENEWAL'\)/);
  assert.match(migration,/status='RENTED',updated_at=now\(\)/);
  assert.match(migration,/Could not synchronize the rented property after activation/);
  assert.match(migration,/FOR UPDATE/);
  assert.match(contracts,/update\(\{status:'ACTIVE'\}\)/);
  assert.match(contracts,/new Event\('lease-activated'\)/);
  assert.doesNotMatch(contracts,/\.from\('properties'\)\.update\(/);
});

test('inventory cannot advertise occupied properties as available and repairs historical drift',()=>{
  assert.match(migration,/Active lease requires RENTED inventory status/);
  assert.match(migration,/properties_contract_status_guard/);
  assert.match(migration,/property\.rented_existing_lease_reconciled/);
  assert.match(fixture,/Existing occupied property backfill was incomplete/);
  assert.match(fixture,/UPDATE public\.properties SET status='AVAILABLE'/);
  assert.match(fixture,/\$\$,'23514'\)/);
  assert.match(legacyClosure,/status='FINISHED'/);
  assert.match(legacyClosure,/status='AVAILABLE',updated_at=now\(\)/);
  assert.match(fixture,/Approved lease did not atomically mark the dwelling rented/);
});

test('status is refreshed from database throughout inventory and linked-owner selection',()=>{
  assert.match(inventory,/Arrendado · contrato activo/);
  for(const marker of ['lease-activated','lease-finished','tenant-rent-updated','visibilitychange'])
    assert.ok(inventory.includes(marker),marker);
  assert.match(onboarding,/occupancyRevision/);
  assert.match(onboarding,/lease-activated/);
  assert.match(onboarding,/lease-finished/);
  assert.match(owners,/Arrendado · no disponible/);
  assert.match(owners,/\!property\.has_active_lease/);
});

test('migration leaves payments, owners and evidence unchanged',()=>{
  for(const s of [migration,legacyClosure]){
    assert.doesNotMatch(s,/DELETE FROM public\.(?:rent_payments|rent_receipts|owner_statements|property_owners)/);
  }
  assert.doesNotMatch(migration,/\.status='ACTIVE'/);
  assert.match(fixture,/owner_statements/);
});
