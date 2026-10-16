import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateAgencyLogo} from '../src/core/agency-logo-validation.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const settings=read('src/modules/settings/SettingsModule.tsx');
const colors=read('src/core/tenant-palette.ts');
const domains=read('src/modules/settings/AgencyCustomDomainRequest.tsx');
const migration=read('supabase/migrations/20261015201000_agency_logos_and_domain_requests.sql');

test('logo upload is image-only and capped at two megabytes',()=>{
 const image=(type,size)=>({type,size});
 assert.equal(validateAgencyLogo(image('image/png',1024)),null);
 assert.equal(validateAgencyLogo(image('image/webp',1024)),null);
 assert.match(validateAgencyLogo(image('image/svg+xml',100)),/SVG/);
 assert.match(validateAgencyLogo(image('image/png',2097153)),/2 MB/);
 assert.match(validateAgencyLogo(image('image/png',0)),/2 MB/);
});
test('settings automatically analyzes selected file and does not change platform branding',()=>{
 assert.match(settings,/Subir mi logo/);
 assert.match(settings,/void selectLogoFile\(file\)/);
 assert.match(settings,/await paletteFromLogoFile\(file\)/);
 assert.match(settings,/uploadAgencyLogo\(organizationId,pendingLogo\)/);
 assert.match(settings,/rollbackAgencyLogoUpload/);
 assert.match(settings,/AgencyCustomDomainRequest organizationId=/);
 assert.match(colors,/createImageBitmap\(file\)/);
 assert.match(colors,/return extractTenantPalette/);
});
test('domain registration creates requests only, with no web routing shortcut',()=>{
 assert.match(migration,/PENDING_DNS/);
 assert.match(migration,/NOT NULL UNIQUE REFERENCES public\.organizations/);
 assert.match(migration,/REVOKE ALL ON public\.agency_custom_domains FROM PUBLIC,anon,authenticated/);
 assert.match(migration,/GRANT SELECT ON public\.agency_custom_domains TO authenticated/);
 assert.doesNotMatch(migration,/GRANT (?:UPDATE|INSERT|DELETE) ON public\.agency_custom_domains TO authenticated/);
 assert.match(migration,/request_agency_custom_domain/);
 assert.match(domains,/Solicitar verificación DNS/);
 assert.match(domains,/Ningún dominio queda activo automáticamente/);
});
