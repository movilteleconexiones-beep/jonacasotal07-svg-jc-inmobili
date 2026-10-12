import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DEAL_STAGE_OPTIONS,isAllowedDealStage,isValidDealCloseDate }
  from '../src/core/deal-edit-validation.ts';

const ui=readFileSync(new URL('../src/modules/deals/DealsModule.tsx',import.meta.url),'utf8');

test('valid browser date can be edited and actual impossible or malformed dates rejected',()=>{
  for(const value of ['2026-10-12','2026-12-31','2028-02-29'])
    assert.equal(isValidDealCloseDate(value),true,value);
  for(const value of ['12/10/2026','2026-02-30','2025-02-29','','2026-13-01','2026-10-1'])
    assert.equal(isValidDealCloseDate(value),false,value);
  assert.match(ui,/closeDate && !isValidDealCloseDate\(closeDate\)/);
  assert.doesNotMatch(ui,/closeDate && !\/\^\\\\d/);
});

test('editable deal stage is presented and included in persistence payload',()=>{
  assert.deepEqual(DEAL_STAGE_OPTIONS.map(x=>x[0]),[
    'INTEREST','VISIT','OFFER','NEGOTIATION','DOCUMENTATION','CLOSING','WON','LOST']);
  assert.equal(isAllowedDealStage('OFFER'),true);
  assert.equal(isAllowedDealStage('BAD'),false);
  assert.match(ui,/name="stage" defaultValue=\{row\.stage\}/);
  assert.match(ui,/const stage = String\(form\.get\('stage'\)/);
  assert.match(ui,/!isAllowedDealStage\(stage\)/);
  assert.match(ui,/operation_type: operation,\s*stage,\s*closed_at:/);
  assert.match(ui,/\.eq\('organization_id', organizationId\)\.eq\('id', row\.id\)/);
  assert.match(ui,/\.select\('id'\)\.maybeSingle\(\)/);
});

test('users get validation or server errors next to the edit form and a successful refresh notice',()=>{
  assert.match(ui,/const \[editMessage, setEditMessage\] = useState/);
  assert.match(ui,/setEditMessage\('Revisa el cliente/);
  assert.match(ui,/setEditMessage\('No se guardaron los cambios: '/);
  assert.match(ui,/\{editMessage && <p role="alert"/);
  assert.match(ui,/await load\(\);\s*setMessage\('Negocio actualizado correctamente\./);
  assert.match(ui,/setEditMessage\('No se confirmó la edición/);
  assert.match(ui,/Precio solicitado \(canon mensual si es arriendo\)/);
  assert.match(ui,/Oferta inicial del cliente/);
});
