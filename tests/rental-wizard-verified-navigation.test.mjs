import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const wizard=readFileSync(new URL('../src/modules/rentals/RentalIntakeWizard.tsx',import.meta.url),'utf8');

test('Next requires a property verified against the current selected owner',()=>{
  assert.match(wizard,/const \[verifiedLinks, setVerifiedLinks\] = useState/);
  assert.match(wizard,/setLinkedProperties\(\[\]\);setVerifiedLinks\(null\)/);
  assert.match(wizard,/setVerifiedLinks\(\{ownerId,organizationId,occupancyRevision\}\)/);
  assert.match(wizard,/verifiedLinks\?\.ownerId===ownerId/);
  assert.match(wizard,/verifiedLinks\?\.organizationId===organizationId/);
  assert.match(wizard,/verifiedLinks\?\.occupancyRevision===occupancyRevision/);
  assert.match(wizard,/linkedProperties\.some\(property=>property\.id===propertyId && canPrepareRental\(property\)\)/);
  assert.match(wizard,/disabled=\{step === 5 \|\| !canContinue\}/);
});

test('Next from Client step requires a client, without disabling historic contract access',()=>{
  assert.match(wizard,/step===1 \? Boolean\(tenantId\) : true/);
  assert.match(wizard,/onSelected=\{id => \{ setTenantId\(id\); setStep\(2\); \}\}/);
  assert.match(wizard,/onCreated=\{id => \{ setTenantId\(id\); setStep\(2\); \}\}/);
  assert.match(wizard,/onClick=\{\(\) => setStep\(index\)\}/);
  assert.match(wizard,/Corregir o anular contrato en borrador/);
});

test('lookup failure or changed occupancy revision blocks stale forward navigation',()=>{
  assert.match(wizard,/!linksLoading && !linksError/);
  assert.match(wizard,/setLinksLoading\(Boolean\(ownerId&&canViewOwners\)\)/);
  assert.match(wizard,/setOccupancyRevision\(n=>n\+1\)/);
  assert.match(wizard,/No se pudo comprobar el inventario o los contratos activos del propietario/);
});
