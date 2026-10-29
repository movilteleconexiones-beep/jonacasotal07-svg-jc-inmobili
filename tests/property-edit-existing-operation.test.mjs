import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const propertyModule=readFileSync(new URL('../src/modules/properties/PropertiesModule.tsx',import.meta.url),'utf8');

test('editing a listed property retains its code, id and pictures',()=>{
  assert.match(propertyModule,/Editar propiedad · \{editingProperty\.code\}/);
  assert.match(propertyModule,/setEditingProperty\(property\)/);
  assert.match(propertyModule,/\.update\(\{operation_type:editOperation,price:parsedPrice\}\)/);
  assert.match(propertyModule,/\.eq\('organization_id',organizationId\)/);
  assert.match(propertyModule,/\.eq\('id',editingProperty\.id\)/);
  assert.doesNotMatch(propertyModule,/\.update\(\{operation_type:editOperation,price:parsedPrice,code:/);
});

test('changing property operation or rental price requires role permission and valid price',()=>{
  assert.match(propertyModule,/can\(PERMISSIONS\.PROPERTIES_EDIT\)/);
  assert.match(propertyModule,/\['SALE','RENT','SALE_OR_RENT','ADMINISTRATION'\]/);
  assert.match(propertyModule,/Number\.isFinite\(parsedPrice\)/);
  assert.match(propertyModule,/parsedPrice <= 0/);
  assert.match(propertyModule,/Canon mensual de arriendo \(COP\)/);
  assert.match(propertyModule,/Guardar cambios/);
});

test('protect occupied properties and avoid overwriting other session changes',()=>{
  assert.match(propertyModule,/\.in\('status',\['ACTIVE','RENEWAL'\]\)/);
  assert.match(propertyModule,/leases\.count > 0 && editOperation !== editingProperty\.operation_type/);
  assert.match(propertyModule,/\.eq\('operation_type',editingProperty\.operation_type\)/);
  assert.match(propertyModule,/request\.is\('price',null\)/);
  assert.match(propertyModule,/request\.eq\('price',editingProperty\.price\)/);
  assert.match(propertyModule,/data\.length !== 1/);
});

test('only authorized role sees the edit affordance',()=>{
  assert.match(propertyModule,/can\(PERMISSIONS\.PROPERTIES_EDIT\)&&<td/);
  assert.match(propertyModule,/onClick=\{\(\)=>beginEdit\(row\)\}/);
  assert.match(propertyModule,/aria-label="Editar propiedad existente"/);
});