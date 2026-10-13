import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import { etiquetaES, tieneTraduccionES, fechaES, dineroES, ETAPAS_NEGOCIO }
  from '../src/core/etiquetas-es.ts';
const root=new URL('../src/',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

test('known database workflow codes have Spanish display labels, without changing the code',()=>{
  const pairs={
    WON:'Cerrado / ganado',LOST:'Cerrado / perdido',
    INTEREST:'Interés',VISIT:'Visita',OFFER:'Oferta recibida',
    NEGOTIATION:'Negociación',DOCUMENTATION:'Documentación',CLOSING:'Cierre',
    ACTIVE:'Activo',PENDING:'Pendiente',PAID:'Pagado',
    DRAFT:'Borrador',VOIDED:'Anulado',APPROVED:'Aprobado',
    PARTIAL:'Abonado parcialmente',AVAILABLE:'Disponible',
    FINISHED:'Finalizado',NO_SHOW:'No asistió',
    REVIEW_REQUIRED:'Revisión requerida',HOUSE:'Casa',CASA:'Casa',
    APARTAMENTO:'Apartamento',REFERRAL:'Referido',
    MEETING:'Reunión',AGENT:'Asesor', CONTRACT:'Contrato',
    MONTHLY:'Mensual',SANDBOX:'Entorno de pruebas',
  };
  for(const [code,spanish] of Object.entries(pairs)){
    assert.equal(etiquetaES(code),spanish,code);
    assert.equal(tieneTraduccionES(code),true,code);
  }
  assert.equal(etiquetaES('apartamento'),'Apartamento');
  assert.equal(etiquetaES('Tipo especial del cliente'),'Tipo especial del cliente');
  assert.equal(etiquetaES(null),'Sin especificar');
  assert.equal(fechaES('2026-10-12'),'12/10/2026');
  assert.equal(dineroES(1800000,'COP').includes('1.800.000'),true);
});

test('deal selector uses Spanish stage names but the stored values remain unchanged',()=>{
  const module=read('modules/deals/DealsModule.tsx');
  assert.match(module,/DEAL_STAGE_OPTIONS\.map\(\(\[code, texto\]\) => <option key=\{code\} value=\{code\}>\{texto\}<\/option>\)/);
  assert.doesNotMatch(module,/\{stage\}<\/option>/);
  assert.match(module,/etiquetaES\(row\.stage\)/);
  assert.ok(ETAPAS_NEGOCIO.some(([key,label])=>key==='WON'&&label==='Cerrado / ganado'));
  assert.match(module,/fechaES\(row\.expected_close_date\)/);
  assert.match(module,/dineroES\(row\.offered_price/);
});

test('finance and customer modules no longer render internal states or record categories in English',()=>{
  const ui=[
    ['modules/finance/RentOwnerBalances.tsx',['etiquetaES(lease.status)','etiquetaES(payment.status)','etiquetaES(statement.status)']],
    ['modules/finance/OwnerDeductionLedger.tsx',['etiquetaES(line.status)']],
    ['modules/properties/PropertiesModule.tsx',['etiquetaES(row.status)','etiquetaES(row.property_type)']],
    ['modules/portal/PortalHub.tsx',['etiquetaES(property.status)','etiquetaES(deal.stage)','etiquetaES(document.document_type)','etiquetaES(item.appointment_type)']],
    ['modules/appointments/AppointmentsModule.tsx',['etiquetaES(row.status)','etiquetaES(row.appointment_type)']],
    ['modules/documents/DocumentsModule.tsx',['etiquetaES(row.document_type)','etiquetaES(row.entity_type)']],
    ['modules/commissions/CommissionsModule.tsx',['etiquetaES(row.commission_type)']],
    ['modules/leads/LeadsModule.tsx',['etiquetaES(lead.priority)']],
    ['modules/settings/SettingsModule.tsx',['etiquetaES(compliance.status)']],
    ['modules/license/LicenseModule.tsx',['etiquetaES(license.license_type)']],
  ];
  for(const [path,tokens] of ui){
    const src=read(path);
    for(const token of tokens)assert.ok(src.includes(token),path+': '+token);
  }
});

test('public document language, navigation and back office are in Spanish',()=>{
  assert.match(read('../index.html'),/<html lang="es"/);
  assert.match(read('core/tenant-menu.ts'),/label: 'Prospectos \/ CRM'/);
  assert.match(read('modules/platform/SuperAdminModule.tsx'),/etiquetaES\(org\.billing_mode\)/);
  assert.match(read('modules/platform/SuperAdminModule.tsx'),/etiquetaES\(org\.subscription_status\)/);
  assert.match(read('modules/dashboard/PrivateDashboard.tsx'),/Superadministrador/);
});
