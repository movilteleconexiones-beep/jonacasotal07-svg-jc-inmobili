import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

const clone='https://zjgstfgiirgjssnihaam.supabase.co';
assert.equal(process.env.JCO_QA96_SUPABASE_URL,clone,'Only QA clone permitted');
const key=process.env.JCO_QA96_PUBLISHABLE_KEY;
const secret=process.env.JCO_QA96_SECRET_KEY;
assert.ok(key?.startsWith('sb_publishable_') && secret?.startsWith('sb_secret_'),'Missing clone credentials');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(clone,secret,options);
const anon=createClient(clone,key,options);
const {data:org,error}=await admin.from('organizations').select('id,slug').eq('slug','sistema-inmobiliario-jco').single();
assert.ok(!error&&org,'Clone organization unavailable');
const {data:flags,error:flagError}=await admin.from('organization_billing_access').select('is_test').eq('organization_id',org.id).single();
assert.ok(!flagError&&flags?.is_test===true,'QA tenant guard failed');
console.log('PASS: protected clone credentials and test tenant');
const base=clone+'/functions/v1/consignment-photo-upload';
async function expectStatus(label,init,status){
 const response=await fetch(base,{...init,redirect:'error',signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,status,label);
 console.log('PASS: '+label);
}
const origin='https://www.inmojco.com';
await expectStatus('allowed preflight',{method:'OPTIONS',headers:{origin}},200);
await expectStatus('foreign origin blocked',{method:'OPTIONS',headers:{origin:'https://example.invalid'}},403);
await expectStatus('GET rejected',{method:'GET',headers:{origin}},405);
function form(bytes,mime){
 const f=new FormData();
 f.set('siteSlug',org.slug);f.set('requestId',randomUUID());
 f.set('reference','CON-'+randomUUID().toUpperCase());f.set('position','0');
 f.set('photo',new Blob([bytes],{type:mime}),'qa.png');return f;
}
await expectStatus('invalid image signature',{method:'POST',headers:{origin},body:form('not a PNG','image/png')},415);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2S8AAAAASUVORK5CYII=','base64');
await expectStatus('unknown submission blocked',{method:'POST',headers:{origin},body:form(png,'image/png')},404);
const missing=await anon.rpc('get_public_property_intake_site',{p_slug:org.slug});
assert.ok(!missing.error && missing.data===null,'Unapproved tenant intake must remain closed');
console.log('PASS: unapproved intake closed via real PostgREST');
const lead=await anon.rpc('submit_public_website_lead_once',{p_slug:org.slug,p_name:'QA synthetic',p_email:'qa@example.invalid',p_phone:'0000000000',p_service:'RENT',p_message:'QA negative consent',p_consent:false,p_trap:'',p_request_id:randomUUID()});
assert.ok(lead.error,'Missing consent unexpectedly accepted');
console.log('PASS: CRM missing consent rejected via real PostgREST');
console.log('QA HTTP NEGATIVE PASS; positive upload and UI remain separate tests');
