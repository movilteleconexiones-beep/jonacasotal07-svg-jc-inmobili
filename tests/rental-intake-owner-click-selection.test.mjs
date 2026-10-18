import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const wizard=read('src/modules/rentals/RentalIntakeWizard.tsx');
const owners=read('src/modules/owners/OwnersModule.tsx');
const properties=read('src/modules/properties/PropertiesModule.tsx');
const leases=read('src/modules/finance/TenantRentEntry.tsx');

test('owners can be selected with a full accessible click and searched by document or name',()=>{
  assert.match(owners,/selectedOwnerId\?:string/);
  assert.match(owners,/onSelect\?:\(ownerId:string,ownerName:string\)=>void/);
  assert.match(owners,/onSelect\(owner\.id,name\)/);
  assert.match(owners,/aria-pressed=\{selected\}/);
  assert.match(owners,/CheckCircle2/);
  assert.match(owners,/type="search" value=\{ownerSearch\}/);
  assert.match(owners,/owner\.document_number/);
  assert.match(owners,/\.eq\('organization_id', organizationId\)/);
  assert.match(owners,/!ownersLoadError && owners\.length === 0/);
  assert.match(owners,/ownersLoadError && <p role="alert"/);
});

test('existing properties can be selected without creating duplicate inventory items',()=>{
  assert.match(properties,/selectedPropertyId\?: string/);
  assert.match(properties,/onSelect\?: \(propertyId:string,propertyName:string\)=>void/);
  assert.match(properties,/onClick=\{\(\)=>selectedPropertyId===row\.id&&onClearSelection/);
  assert.match(properties,/: onSelect\(row\.id,\[row\.code,row\.title\]/);
  assert.match(properties,/aria-pressed=\{selectedPropertyId===row\.id\}/);
  assert.match(properties,/\{onSelect&&<th className="px-4 py-3">Elegir<\/th>\}/);
  assert.match(properties,/\{onSelect\?9:8\}/);
});

test('wizard remembers one owner and clears old ownership choice on property change',()=>{
  assert.match(wizard,/\[propertyId, setPropertyId\]/);
  assert.match(wizard,/\[ownerId, setOwnerId\]/);
  assert.match(wizard,/selectedOwnerId=\{ownerId\}/);
  assert.match(wizard,/onSelect=\{\(id,name\) => \{[\s\S]*?setOwnerId\(id\); setOwnerName\(name\);/);
  assert.match(wizard,/if \(id !== propertyId\) \{[\s\S]*?setOwnerId\(undefined\);[\s\S]*?setOwnerName\(''\);/);
  assert.match(wizard,/onCreated=\{id => \{[\s\S]*?setOwnerId\(undefined\)/);
  assert.match(wizard,/Propietario elegido:/);
  assert.match(wizard,/preferredPropertyId=\{propertyId\} preferredTenantId=\{tenantId\} preferredOwnerId=\{ownerId\}/);
});

test('lease owner is preselected but still validated as an allowed organization owner',()=>{
  assert.match(leases,/preferredOwnerId\?:string/);
  assert.match(leases,/name="owner_id" defaultValue=\{preferredOwnerId\|\|''\}/);
  assert.match(leases,/ownerId&&!owners\.some\(x=>x\.id===ownerId\)/);
  assert.match(leases,/organization_id:organizationId,property_id:propertyId,tenant_id:tenantId,owner_id:ownerId\|\|null/);
  // No implicit changes to property_ownerships, percentages or payment balances.
  assert.doesNotMatch(wizard,/\.from\('property_ownerships'\)\.insert\(/);
  assert.doesNotMatch(owners,/onSelect\(owner\.id,name\)[\s\S]*?\.from\('property_ownerships'\)\.update\(/);
});

test('selected property or owner can be cleared explicitly or by clicking the active row',()=>{
  assert.match(wizard,/const clearPropertySelection = \(\) => \{/);
  assert.match(wizard,/const clearOwnerSelection = \(\) => \{/);
  assert.match(wizard,/setPropertyId\(undefined\)/);
  assert.match(wizard,/setPropertyName\(''\)/);
  assert.match(wizard,/setOwnerId\(undefined\)/);
  assert.match(wizard,/setOwnerName\(''\)/);
  assert.match(wizard,/onClearSelection=\{clearPropertySelection\}/);
  assert.match(wizard,/onClearSelection=\{clearOwnerSelection\}/);
  assert.match(wizard,/aria-label="Quitar selección de vivienda"/);
  assert.match(wizard,/aria-label="Quitar selección de propietario"/);
  assert.match(properties,/onClearSelection\?: \(\) => void/);
  assert.match(properties,/\? onClearSelection\(\)/);
  assert.match(owners,/onClearSelection\?:\(\)=>void/);
  assert.match(owners,/selected&&onClearSelection\?onClearSelection\(\)/);
  assert.match(properties,/Quitar selección/);
  assert.match(owners,/Quitar selección/);
});

test('clearing a wizard choice never removes source records or changes money',()=>{
  assert.match(wizard,/setLeaseId\(undefined\)/);
  assert.match(wizard,/Solo se cambió la selección de este asistente/);
  for(const source of [wizard, properties.slice(properties.indexOf('selectedPropertyId===row.id&&onClearSelection')),owners.slice(owners.indexOf('selected&&onClearSelection'))]){
    assert.doesNotMatch(source,/supabase\.from\('leases'\)\.delete\(/);
    assert.doesNotMatch(source,/supabase\.from\('rent_payments'\)\.update\(/);
  }
});
