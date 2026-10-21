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
 assert.match(app,/contactBusy/);
 assert.match(app,/disabled=\{contactBusy\}/);
 assert.match(app,/type="checkbox" required checked=\{contactConsent\}/);
 assert.match(app,/La inmobiliaria es responsable de su tratamiento/);
 assert.match(app,/Consulta registrada correctamente/);
 assert.match(app,/quedó registrada en el CRM de/);
 assert.match(app,/No fue posible registrar la consulta/);
 assert.match(app,/!tenantSlug && branding\.email/);
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
