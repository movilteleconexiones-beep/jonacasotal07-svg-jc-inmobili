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
  assert.match(source,/if \(useReplaySafeCrm\) clearPublicInquiryAttempt\(tenantSlug\)/);
  assert.match(source,/contactSubmitInFlight\.current = true/);
  assert.match(source,/contactSubmitInFlight\.current = false/);
});

test('tenant inquiry is unavailable without policy and a verified email fallback', () => {
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(app,/const contactFallbackEmail = /);
  assert.match(app,/tenantSlug && !automaticContactEnabled && !contactFallbackEmail/);
  assert.match(app,/Contacto temporalmente no disponible/);
  assert.match(app,/No solicitaremos tus datos hasta que exista un canal/);
  assert.match(app,/contactSubmitted \? \(/);
  assert.match(app,/href=\{\x60mailto:\$\{contactFallbackEmail\}/);
  assert.match(app,/setContactError\('La inmobiliaria todavía no tiene un canal de contacto configurado/);
});
