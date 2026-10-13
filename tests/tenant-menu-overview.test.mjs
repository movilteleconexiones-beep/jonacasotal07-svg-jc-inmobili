import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantMenu } from '../src/core/tenant-menu.ts';
import { parsePlatformOverview, monthLabel } from '../src/core/platform-overview.ts';

const labels = ['Inicio','Propiedades','Clientes','Nueva vinculación','Prospectos / CRM','Agenda','Negocios','Propietarios','Documentos','Comisiones','Reportes','Mi Portal','Usuarios','Importar datos','Configuración','Licencia'];
test('a complete owner keeps the menu order with guided rental intake', () => {
  const menu = tenantMenu(() => true,true,false);
  assert.deepEqual(menu.map(item => item.label),labels);
  assert.ok(menu.every(item => item.available));
  assert.ok(menu.every(item => !['SUPER_ADMIN','BILLING','CONSIGNMENTS'].includes(item.id)));
});
test('restricted owners keep the menu with unavailable modules locked', () => {
  const menu = tenantMenu(() => false,true,false);
  assert.deepEqual(menu.map(item => item.label),labels);
  assert.deepEqual(menu.filter(item => item.available).map(item => item.id),['DASHBOARD','PORTAL','LICENSE']);
  assert.deepEqual(tenantMenu(() => true,true,true).filter(item => item.available).map(item => item.id),['LICENSE']);
});
test('ordinary members only see modules granted by their effective permissions', () => {
  assert.deepEqual(tenantMenu(p => p === 'properties.view',false,false).map(item => item.id),['DASHBOARD','PROPERTIES','PORTAL']);
});
const overview = () => ({ timezone:'America/Bogota',generated_at:'2026-10-10T23:00:00Z',organizations:[],
  totals:{total:0,active:0,inactive:0,pending:0,suspended:0,expired:0,tests:0},
  monthly:[{month:'2026-10',registered:0,accumulated:0,active_now:0,inactive_now:0,pending_now:0,suspended_now:0,expired_now:0,tests:0}] });
test('an empty valid overview stays empty, while missing counts are errors', () => {
  assert.equal(parsePlatformOverview(overview()).totals.total,0);
  for (const invalid of [null,{}, {...overview(),totals:{}}, {...overview(),totals:{...overview().totals,total:-1}}, {...overview(),monthly:[{...overview().monthly[0],month:'2026-13'}]}]) {
    assert.throws(() => parsePlatformOverview(invalid));
  }
  assert.match(monthLabel('2026-10'),/octubre.*2026/);
});

test('advisor with leases.view sees the guided rental intake without financial administration',()=>{
  const menu=tenantMenu(p=>p==='leases.view',false,false);
  assert.deepEqual(menu.map(x=>x.id),['DASHBOARD','RENTAL_INTAKE','PORTAL']);
});
