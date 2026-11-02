import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const wizard=readFileSync(new URL('../src/modules/rentals/RentalIntakeWizard.tsx',import.meta.url),'utf8');
const correction=readFileSync(new URL('../src/modules/finance/ActiveLeaseCorrection.tsx',import.meta.url),'utf8');

test('existing contract action is visible from wizard header without creating a new lease',()=>{
  const header=wizard.indexOf('<header');
  const button=wizard.indexOf('Corregir contrato existente');
  const stages=wizard.indexOf('{step === 0');
  assert.ok(header>=0 && button>header && button<stages);
  assert.match(wizard,/onClick=\{\(\) => setShowActiveCorrection\(true\)\}/);
  assert.match(wizard,/aria-controls="active-lease-correction"/);
  assert.match(wizard,/aria-label="Corrección administrativa de contratos activos"/);
});

test('editor and shortcut demand the same administrator, contract and document permissions',()=>{
  assert.match(wizard,/isAdministrator = Boolean\(activeMembership\?\.roles\.some\(role=>role\.key==='ADMIN'\)\)/);
  assert.match(wizard,/canCorrectActive = isAdministrator &&\s*can\(PERMISSIONS\.LEASES_EDIT\) && can\(PERMISSIONS\.DOCUMENTS_VIEW\)/);
  assert.match(wizard,/\{canCorrectActive && \(\s*<section/);
  assert.match(wizard,/\{canCorrectActive && \(\s*<button/);
  assert.match(wizard,/\{isAdministrator && !canCorrectActive && \(/);
  assert.match(correction,/roles\.some\(role=>role\.key==='ADMIN'\)/);
  assert.match(correction,/can\(PERMISSIONS\.LEASES_EDIT\) && can\(PERMISSIONS\.DOCUMENTS_VIEW\)/);
});

test('draft correction remains administrative and does not duplicate client creation',()=>{
  assert.match(wizard,/canCorrectDraft = isAdministrator && canActivate/);
  assert.match(wizard,/\{canCorrectDraft && step !== 2 && \(/);
  assert.match(wizard,/onClick=\{\(\) => setStep\(2\)\}/);
  assert.equal((wizard.match(/<ContactsModule contactsOnly/g)||[]).length,1);
  assert.equal((wizard.match(/<ActiveLeaseCorrection/g)||[]).length,1);
});


test('active lease correction prevents a double submission before asynchronous preflight',()=>{
  const functionBody=correction.slice(correction.indexOf('async function rectify('),correction.indexOf('  if(!authorized)return null;'));
  assert.match(correction,/import \{ useEffect, useRef, useState, type FormEvent \} from 'react'/);
  assert.match(correction,/const correctionInFlight=useRef\(false\)/);
  assert.match(functionBody,/if\(!authorized\|\|busy\|\|correctionInFlight\.current\|\|!selectedLease/);
  const lock=functionBody.indexOf('correctionInFlight.current=true');
  const firstRead=functionBody.indexOf('await supabase.from(');
  const save=functionBody.indexOf("await supabase.rpc('admin_rectify_active_lease'");
  assert.ok(lock>0 && lock<firstRead && firstRead<save,'synchronous lock must precede every async request');
  assert.match(functionBody,/try\s*\{/);
  assert.match(functionBody,/finally\s*\{correctionInFlight\.current=false;setBusy\(false\)\}/);
  assert.match(functionBody,/El contrato cambió desde que abriste el formulario/);
  assert.match(functionBody,/rentalCanonWarning\(currentMismatch\)/);
});
