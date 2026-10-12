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
  assert.match(properties,/onClick=\{\(\)=>onSelect\(row\.id,\[row\.code,row\.title\]/);
  assert.match(properties,/aria-pressed=\{selectedPropertyId===row\.id\}/);
  assert.match(properties,/\{onSelect&&<th className="px-4 py-3">Elegir<\/th>\}/);
  assert.match(properties,/\{onSelect\?8:7\}/);
});

test('wizard remembers one owner and clears old ownership choice on property change',()=>{
  assert.match(wizard,/\[propertyId, setPropertyId\]/);
  assert.match(wizard,/\[ownerId, setOwnerId\]/);
  assert.match(wizard,/selectedOwnerId=\{ownerId\}/);
  assert.match(wizard,/onSelect=\{\(id,name\) => \{ setOwnerId\(id\); setOwnerName\(name\); \}\}/);
  assert.match(wizard,/if \(id !== propertyId\) \{ setOwnerId\(undefined\); setOwnerName\(''\); \}/);
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
