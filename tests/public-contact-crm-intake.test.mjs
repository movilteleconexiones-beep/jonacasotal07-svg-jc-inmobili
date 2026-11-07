import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('tenant contact page registers a CRM prospect only after explicit consent',()=>{
 const app=read('src/App.tsx');
 assert.match(app,/supabase\.rpc\('submit_public_website_lead'/);
 assert.match(app,/p_slug: tenantSlug/);
 assert.match(app,/p_consent: contactConsent/);
 assert.match(app,/p_trap: contactTrap/);
 assert.match(app,/const automaticContactEnabled = Boolean\(tenantSlug && privacyPolicyUrl\)/);
 assert.match(app,/política de tratamiento de datos/);
 assert.match(app,/La inmobiliaria aún no ha publicado su política/);
 assert.match(app,/contactBusy/);
 assert.match(app,/disabled=\{contactBusy\}/);
 assert.match(app,/type="checkbox" required checked=\{contactConsent\}/);
 assert.match(app,/La inmobiliaria es responsable de su tratamiento/);
 assert.match(app,/Consulta registrada correctamente/);
 assert.match(app,/quedó registrada en el CRM de/);
 assert.match(app,/No fue posible registrar la consulta/);
 assert.match(app,/!automaticContactEnabled && contactFallbackEmail/);
 assert.match(app,/No se ha confirmado una cita|todavía no se ha confirmado una cita/);
});

test('public CRM function has bounded inputs, operational tenant selection and no private data return',()=>{
 const sql=read('supabase/migrations/20261020221500_public_website_leads.sql');
 assert.equal((sql.match(/^BEGIN;$/gm)||[]).length,1);
 assert.equal((sql.match(/^COMMIT;$/gm)||[]).length,1);
 assert.match(sql,/SECURITY DEFINER/);
 assert.match(sql,/SET search_path TO ''/);
 assert.match(sql,/p_consent IS DISTINCT FROM true/);
 assert.match(sql,/s\.enable_public_website IS TRUE/);
 assert.match(sql,/public_page_content->>'privacyPolicyUrl'/);
 assert.match(sql,/jco_private\.operational_access\(o\.id\)/);
 assert.match(sql,/WHERE o\.slug = p_slug/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/c\.source='WEBSITE'/);
 assert.match(sql,/INSERT INTO public\.contacts/);
 assert.match(sql,/INSERT INTO public\.leads/);
 assert.match(sql,/RETURN true;/);
 assert.match(sql,/RETURNS boolean/);
 assert.match(sql,/REVOKE ALL ON FUNCTION .* FROM PUBLIC/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION .* TO anon, authenticated/);
 assert.doesNotMatch(sql,/GRANT (?:INSERT|SELECT|UPDATE|DELETE) ON (?:public\.)?(?:contacts|leads) TO anon/);
});


test('agency settings explain the missing privacy-policy dependency without publishing legal terms', () => {
 const settings = read('src/modules/settings/SettingsModule.tsx');
 assert.match(settings, /const hasPublishedPrivacyPolicy =/);
 assert.match(settings, /!hasPublishedPrivacyPolicy && publicPage\.showContact/);
 assert.match(settings, /role="status"/);
 assert.match(settings, /Para recibir consultas directamente en el CRM/);
 assert.match(settings, /href="#politica-datos"/);
 assert.match(settings, /id="politica-datos"/);
 assert.match(settings, /Política de datos personales/);
 assert.doesNotMatch(settings, /https:\/\/www\.inmojco\.com\/politica-de-datos\/\$\{?currentSlug/);
});


test('web intake keeps a private, tenant-scoped receipt of the accepted policy URL', () => {
 const sql=read('supabase/migrations/20261021041500_public_website_contact_consent_receipts.sql');
 assert.match(sql,/CREATE TABLE private\.website_contact_consents/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON private\.website_contact_consents FROM PUBLIC, anon, authenticated, service_role/);
 assert.match(sql,/SELECT o\.id, b\.public_page_content->>'privacyPolicyUrl' INTO v_org, v_policy_url/);
 assert.match(sql,/INSERT INTO private\.website_contact_consents/);
 assert.match(sql,/policy_url text NOT NULL/);
 assert.match(sql,/consented_at timestamptz NOT NULL DEFAULT now\(\)/);
 assert.match(sql,/INSERT INTO public\.leads/);
});

test('public intake never asks for PII without a configured destination',()=>{
 const app=read('src/App.tsx');
 const settings=read('src/modules/settings/SettingsModule.tsx');
 assert.match(app,/const contactFallbackEmail = /);
 assert.match(app,/!automaticContactEnabled && !contactFallbackEmail/);
 assert.match(app,/Contacto temporalmente no disponible/);
 assert.match(app,/No solicitaremos tus datos hasta que exista un canal/);
 assert.match(app,/href=\{\x60mailto:\$\{contactFallbackEmail\}/);
 assert.match(app,/setContactError\(tenantSlug/);
  assert.match(app,/La inmobiliaria todavía no tiene un canal de contacto configurado/);
  assert.match(app,/INMOJCO todavía no tiene un correo comercial configurado/);
 assert.match(settings,/const hasPublishedContactEmail = /);
 assert.match(settings,/Configurar correo comercial/);
 assert.match(settings,/id="correo-comercial"/);
});

test('CRM submit refuses rapid duplicate clicks and warns on uncertain response',()=>{
 const app=read('src/App.tsx');
 const handler=app.slice(app.indexOf('const handleContactSubmit = async'),app.indexOf('if (isSuperAdminRoute)'));
 assert.match(handler,/contactSubmitInFlight\.current/);
 assert.match(handler,/if \(contactBusy \|\| contactSubmitInFlight\.current\) return/);
 assert.match(handler,/contactSubmitInFlight\.current = true;\s*setContactBusy\(true\)/);
 assert.match(handler,/finally \{\s*contactSubmitInFlight\.current = false;/);
 assert.match(handler,/Comprueba si llegó al CRM antes de volver a enviarla/);
 assert.match(handler,/supabase\.rpc\('submit_public_website_lead'/);
 // The optional new RPC is present but gated OFF until the DB-first rollout.
 assert.match(handler,/const useReplaySafeCrm = import\.meta\.env\.VITE_PUBLIC_CRM_IDEMPOTENT === 'true'/);
 assert.match(handler,/useReplaySafeCrm\s*\? await supabase\.rpc\('submit_public_website_lead_once'/);
 assert.match(handler,/: await supabase\.rpc\('submit_public_website_lead', inquiry\)/);
 assert.match(handler,/if \(useReplaySafeCrm\) clearPublicInquiryAttempt\(submittedTenantSlug\)/);
});
