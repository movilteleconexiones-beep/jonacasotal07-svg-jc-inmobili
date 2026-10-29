import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const contacts=read('src/modules/contacts/ContactsModule.tsx');
const wizard=read('src/modules/rentals/RentalIntakeWizard.tsx');
const dashboard=read('src/modules/dashboard/PrivateDashboard.tsx');
const menu=read('src/core/tenant-menu.ts');

test('Clientes only registers, consults and corrects contacts with no duplicate rental operations',()=>{
  assert.match(contacts,/Clientes y contactos/);
  assert.match(contacts,/Nuevo contacto/);
  assert.match(contacts,/Editar cliente/);
  assert.match(contacts,/Eliminar si no está vinculado/);
  assert.match(contacts,/admin_correct_client_contact/);
  assert.match(contacts,/admin_delete_unlinked_contact/);
  assert.match(contacts,/Ya existe una ficha con este correo/);
  for(const forbidden of ['TenantRentEntry','ActiveLeaseCorrection','TenantRentBalanceSummary',
    'Registrar abono','Crear cobro mensual','Contrato firmado (PDF)']) {
    assert.ok(!contacts.includes(forbidden),`Clients must not contain ${forbidden}`);
  }
});

test('Nueva vinculación keeps the existing six-stage workflow including client reuse',()=>{
  const steps=['Vivienda','Cliente','Contrato','PDF firmado','Aprobación','Cobros'];
  for(const name of steps) assert.ok(wizard.includes(name),name);
  assert.match(wizard,/<ContactsModule contactsOnly/);
  assert.ok(wizard.includes('onCreated={id => { setTenantId(id); setStep(2); }}'));
  assert.ok(wizard.includes('onSelected={id => { setTenantId(id); setStep(2); }}'));
  assert.match(wizard,/step === 2/);
  assert.match(wizard,/mode="DRAFT"/);
  assert.match(wizard,/mode="SIGNED_PDF"/);
  assert.match(wizard,/mode="APPROVAL"/);
  assert.match(wizard,/mode="BILLING"/);
  assert.match(wizard,/onDraftCreated=\{id => \{ setLeaseId\(id\); setStep\(3\); \}\}/);
  assert.match(wizard,/onPdfUploaded=\{id => \{ setLeaseId\(id\); setStep\(4\); \}\}/);
  assert.match(wizard,/onActivated=\{id => \{ setLeaseId\(id\); setStep\(5\); \}\}/);
});

test('signed-active correction and rental balance still have accessible permission-gated location',()=>{
  assert.match(wizard,/can\(PERMISSIONS\.LEASES_EDIT\) && can\(PERMISSIONS\.DOCUMENTS_VIEW\)/);
  assert.match(wizard,/<ActiveLeaseCorrection/);
  assert.match(wizard,/Corregir un contrato activo existente/);
  assert.match(wizard,/can\(PERMISSIONS\.RENT_PAYMENTS_VIEW\)/);
  assert.match(wizard,/<TenantRentBalanceSummary/);
  assert.match(wizard,/Consultar cánones, saldos y estados de cuenta/);
  assert.match(wizard,/step === 5/);
  assert.match(wizard,/<RentalContractClosure/);
});

test('dashboard retains one client route and one rental workflow route',()=>{
  assert.match(menu,/id: 'CONTACTS', label: 'Clientes'/);
  assert.match(menu,/id: 'RENTAL_INTAKE', label: 'Nueva vinculación'/);
  assert.match(dashboard,/<ContactsModule/);
  assert.match(dashboard,/<RentalIntakeWizard/);
  assert.equal((wizard.match(/<TenantRentEntry/g)||[]).length,4);
});

test('the client step reuses an existing scoped contact and does not expose edit or deletion actions',()=>{
  assert.ok(contacts.includes('onSelected?:(contactId:string)=>void'));
  assert.match(contacts,/contactsOnly&&onSelected&&<button/);
  assert.ok(contacts.includes('onClick={()=>onSelected(row.id)}'));
  assert.match(contacts,/Elegir cliente para el contrato/);
  assert.match(contacts,/adminMayCorrect&&!contactsOnly&&<>/);
  assert.match(wizard,/Selecciona un cliente registrado/);
});
