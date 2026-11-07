import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {getPublicInquiryRequestId,clearPublicInquiryAttempt} from '../src/core/public-inquiry-attempt.ts';

function makeStore() {
  const values=new Map();
  return {
    getItem(key) {return values.get(key)??null;},
    setItem(key,value) {values.set(key,value);},
    removeItem(key) {values.delete(key);},
    snapshot() {return [...values.values()].join(' ');}
  };
}

const base={
  p_slug:'alpha-agency',p_name:'Ana Prueba',p_email:'ana@example.test',
  p_phone:'+57 300 123 4567',p_service:'Ventas',p_message:'Consulta legítima',
  p_consent:true,p_trap:'',
};

test('same attempted public inquiry keeps request UUID across network retries',async()=>{
  const store=makeStore();
  const first=await getPublicInquiryRequestId(base,store);
  assert.match(first,/^[0-9a-f-]{36}$/i);
  const retry=await getPublicInquiryRequestId({...base,p_email:'ANA@example.test'},store);
  assert.equal(retry,first,'email normalization should preserve the same logical inquiry');
  assert.doesNotMatch(store.snapshot(),/ana@example.test|Consulta legítima|Ana Prueba/,
    'no raw personal inquiry data should be written to session storage');
  clearPublicInquiryAttempt(base.p_slug,store);
});

test('edited request, new tenant and confirmed success use distinct UUIDs',async()=>{
  const store=makeStore();
  const first=await getPublicInquiryRequestId(base,store);
  const changed=await getPublicInquiryRequestId({...base,p_message:'Otra consulta'},store);
  assert.notEqual(changed,first);
  const otherTenant=await getPublicInquiryRequestId({...base,p_slug:'bravo-agency'},store);
  assert.notEqual(otherTenant,changed);
  clearPublicInquiryAttempt(base.p_slug,store);
  const next=await getPublicInquiryRequestId({...base,p_message:'Otra consulta'},store);
  assert.notEqual(next,changed);
  clearPublicInquiryAttempt(base.p_slug,store);
  clearPublicInquiryAttempt('bravo-agency',store);
});

test('portal rollout is OFF by default and guarded by the matching DB deployment',()=>{
  const source=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const env=readFileSync(new URL('../.env.example',import.meta.url),'utf8');
  assert.match(env,/VITE_PUBLIC_CRM_IDEMPOTENT="false"/);
  assert.match(source,/VITE_PUBLIC_CRM_IDEMPOTENT === 'true'/);
  assert.match(source,/supabase\.rpc\('submit_public_website_lead_once'/);
  assert.match(source,/p_request_id: await getPublicInquiryRequestId\(inquiry\)/);
  assert.match(source,/: await supabase\.rpc\('submit_public_website_lead', inquiry\)/);
  assert.match(source,/if \(useReplaySafeCrm\) clearPublicInquiryAttempt\(submittedTenantSlug\)/);
  assert.match(source,/contactSubmitInFlight\.current = true/);
  assert.match(source,/contactSubmitInFlight\.current = false/);
});

test('tenant inquiry is unavailable without policy and a verified email fallback', () => {
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(app,/const contactFallbackEmail = /);
  assert.match(app,/!automaticContactEnabled && !contactFallbackEmail/);
  assert.match(app,/Contacto temporalmente no disponible/);
  assert.match(app,/No solicitaremos tus datos hasta que exista un canal/);
  assert.match(app,/contactSubmitted \? \(/);
  assert.match(app,/href=\{\x60mailto:\$\{contactFallbackEmail\}/);
  assert.match(app,/setContactError\(tenantSlug/);
  assert.match(app,/La inmobiliaria todavía no tiene un canal de contacto configurado/);
  assert.match(app,/INMOJCO todavía no tiene un correo comercial configurado/);
});

test('settings warns the tenant owner when public inquiries have no valid destination', () => {
  const settings=readFileSync(new URL('../src/modules/settings/SettingsModule.tsx',import.meta.url),'utf8');
  assert.match(settings,/const hasPublishedContactEmail = /);
  assert.match(settings,/El formulario público no puede recibir consultas/);
  assert.match(settings,/Configurar correo comercial/);
  assert.match(settings,/id="correo-comercial"/);
  assert.match(settings,/sin ella, solo podrá prepararse un correo manual cuando haya un correo comercial válido/);
});

test('rejected storage writes cannot resurrect an older UUID after editing inquiry',async()=>{
  const values=new Map();
  let rejectWrites=false;
  const store={
    getItem(key){return values.get(key)??null;},
    setItem(key,value){if(rejectWrites) throw new Error('storage quota');values.set(key,value);},
    removeItem(key){values.delete(key);}
  };
  const original=await getPublicInquiryRequestId(base,store);
  rejectWrites=true;
  const changedInquiry={...base,p_message:'Mensaje corregido'};
  const changed=await getPublicInquiryRequestId(changedInquiry,store);
  assert.notEqual(changed,original);
  const retry=await getPublicInquiryRequestId(changedInquiry,store);
  assert.equal(retry,changed,'stale persisted UUID must not replace a newer in-memory attempt');
  clearPublicInquiryAttempt(base.p_slug,store);
});

test('confirmed inquiry cannot reuse a completed UUID when sessionStorage removal fails',async()=>{
  const values=new Map();
  let rejectRemoval=false;
  const store={
    getItem(key){return values.get(key)??null;},
    setItem(key,value){values.set(key,value);},
    removeItem(key){if(rejectRemoval) throw new Error('storage blocked');values.delete(key);}
  };
  const first=await getPublicInquiryRequestId(base,store);
  rejectRemoval=true;
  clearPublicInquiryAttempt(base.p_slug,store);
  const second=await getPublicInquiryRequestId(base,store);
  assert.notEqual(second,first,'a new legitimate inquiry must not be silently treated as a completed replay');
  assert.equal(await getPublicInquiryRequestId(base,store),second,'retry of the new inquiry remains idempotent');
  rejectRemoval=false;
  clearPublicInquiryAttempt(base.p_slug,store);
});


test('two completed submissions cannot resurrect the first UUID after repeated storage failures',async()=>{
  const values=new Map();
  let rejectWrites=false;
  let rejectRemoval=false;
  const store={
    getItem(key){return values.get(key)??null;},
    setItem(key,value){if(rejectWrites) throw new Error('quota');values.set(key,value);},
    removeItem(key){if(rejectRemoval) throw new Error('blocked');values.delete(key);}
  };
  const first=await getPublicInquiryRequestId(base,store);
  rejectRemoval=true;
  rejectWrites=true;
  clearPublicInquiryAttempt(base.p_slug,store);
  const second=await getPublicInquiryRequestId(base,store);
  assert.notEqual(second,first);
  clearPublicInquiryAttempt(base.p_slug,store);
  const third=await getPublicInquiryRequestId(base,store);
  assert.notEqual(third,first,'stale first UUID must not be resurrected after second success');
  assert.notEqual(third,second,'third legitimate inquiry needs its own UUID');
  assert.equal(await getPublicInquiryRequestId(base,store),third,'third inquiry retries remain stable');
  rejectRemoval=false;
  rejectWrites=false;
  clearPublicInquiryAttempt(base.p_slug,store);
});

test('platform landing does not collect contacts without a real receiving mailbox', () => {
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const auth=readFileSync(new URL('../src/components/AuthAccessButton.tsx',import.meta.url),'utf8');
  assert.match(app, /if \(!automaticContactEnabled && !contactFallbackEmail\)/);
  assert.match(app, /\{!automaticContactEnabled && !contactFallbackEmail \? \(/);
  assert.match(app, /INMOJCO todavía no tiene un correo comercial configurado para recibir consultas/);
  assert.match(app, /No solicitaremos tus datos hasta que exista un canal de atención verificable/);
  assert.match(app, /<AuthAccessButton showIdentity=\{false\} initialMode="SIGN_UP" \/>/);
  assert.match(auth, /initialMode = 'SIGN_IN'/);
  assert.match(auth, /setMode\(initialMode\);/);
  assert.match(auth, /initialMode === 'SIGN_UP' \? 'Crear cuenta' : 'Acceso'/);
});
