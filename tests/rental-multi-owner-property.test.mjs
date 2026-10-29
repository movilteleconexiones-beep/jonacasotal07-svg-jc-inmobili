import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  automaticOwnerId, canPrepareRental, rentalAvailability,
} from '../src/core/rental-owner-selection.ts';

const wizard=readFileSync(new URL('../src/modules/rentals/RentalIntakeWizard.tsx',import.meta.url),'utf8');
const draft=readFileSync(new URL('../src/modules/finance/TenantRentEntry.tsx',import.meta.url),'utf8');

test('one owner can own many different properties without duplicate owner or inventory',()=>{
  const links=[
    {property_id:'property-1',owner_id:'owner-1',is_primary:true},
    {property_id:'property-2',owner_id:'owner-1',is_primary:true},
    {property_id:'property-3',owner_id:'owner-1',is_primary:true},
  ];
  assert.equal(new Set(links.map(row=>row.owner_id)).size,1);
  assert.equal(new Set(links.map(row=>row.property_id)).size,3);
  assert.equal(automaticOwnerId(links.filter(link=>link.property_id==='property-2')),'owner-1');
  assert.match(wizard,/\.eq\('owner_id',ownerId\)\.limit\(501\)/);
  assert.match(wizard,/\.in\('id',ids\)\.limit\(501\)/);
  assert.match(wizard,/linkedProperties\.map\(item=>/);
  assert.match(wizard,/Elegir inmueble/);
  assert.match(wizard,/setPropertyId\(item\.id\)/);
  assert.match(wizard,/setOwnerId\(owner\.id\);setOwnerName\(owner\.name\)/);
});

test('auto-fill owner only if it is unambiguous; preserve co-owner manual choice',()=>{
  assert.equal(automaticOwnerId([]),null);
  assert.equal(automaticOwnerId([{owner_id:'x',is_primary:false}]),'x');
  assert.equal(automaticOwnerId([{owner_id:'x',is_primary:false},{owner_id:'y',is_primary:true}]),'y');
  assert.equal(automaticOwnerId([{owner_id:'x',is_primary:false},{owner_id:'y',is_primary:false}]),null);
  assert.equal(automaticOwnerId([{owner_id:'x',is_primary:true},{owner_id:'y',is_primary:true}]),null);
  assert.match(wizard,/ownerChoices\.map\(choice=>/);
  assert.match(wizard,/is_primary:link\.is_primary/);
  assert.match(wizard,/Elige quién figurará en el borrador/);
});

test('property inventory status AND active contract prevent misleading availability',()=>{
  const p={id:'a',code:'001',title:'Apartamento',status:'AVAILABLE',operation_type:'RENT',has_active_lease:false};
  assert.equal(canPrepareRental(p),true);
  assert.equal(canPrepareRental({...p,has_active_lease:true}),false);
  assert.equal(canPrepareRental({...p,status:'RENTED'}),false);
  assert.equal(canPrepareRental({...p,status:'INACTIVE'}),false);
  assert.equal(canPrepareRental({...p,operation_type:'SALE'}),false);
  assert.equal(canPrepareRental({...p,status:'RESERVED'}),true);
  assert.match(rentalAvailability({...p,has_active_lease:true}),/Contrato activo/);
  assert.match(rentalAvailability({...p,status:'RESERVED'}),/revisar/);
  assert.match(wizard,/disabled=\{!available\}/);
  assert.match(wizard,/\.in\('status',\['ACTIVE','RENEWAL'\]\)/);
});

test('lookup scopes owner, property and active leases to tenant with safe count checks',()=>{
  assert.match(wizard,/\.eq\('property_id',selectedId\)\.limit\(501\)/);
  assert.match(wizard,/\.eq\('organization_id',organizationId\)\.in\('id',ids\)/);
  assert.match(wizard,/\.eq\('organization_id',organizationId\)\.in\('property_id',ids\)/);
  assert.match(wizard,/version !== lookupVersion\.current/);
  assert.match(wizard,/if\(cancelled\)return/);
  assert.match(wizard,/\.count[^\n]*|links\.count/);
  assert.match(wizard,/No se pudo comprobar el inventario o los contratos activos/);
  assert.doesNotMatch(wizard,/\.from\('property_ownerships'\)\s*\.insert\(/);
});

test('guided draft validates owner-property association and real availability before insert',()=>{
  // All contract-entry modes must now verify availability, not only DRAFT.
  assert.doesNotMatch(draft,/if \(mode==='DRAFT'\)/);
  assert.match(draft,/\.in\('status',\['DRAFT','ACTIVE','RENEWAL'\]\)/);
  assert.match(draft,/\.eq\('organization_id',organizationId\)\.eq\('id',propertyId\)\.maybeSingle\(\)/);
  assert.match(draft,/\.eq\('organization_id',organizationId\)\.eq\('property_id',propertyId\)/);
  assert.match(draft,/\.eq\('property_id',propertyId\)\.eq\('owner_id',ownerId\)\.maybeSingle\(\)/);
  assert.match(draft,/if\(linkError\|\|!link\)/);
  assert.match(draft,/if\(!canPrepareRental/);
  assert.match(draft,/No se pudo verificar la disponibilidad/);
  assert.match(draft,/No se pudo guardar el contrato/);
  assert.doesNotMatch(wizard,/\.from\('leases'\)\.update\(/);
  assert.doesNotMatch(wizard,/\.from\('property_ownerships'\)\.delete\(/);
});
