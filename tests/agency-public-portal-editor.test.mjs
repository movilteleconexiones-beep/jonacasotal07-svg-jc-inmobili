import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePublicPageContent, validPublicPageContent, DEFAULT_PUBLIC_PAGE } from '../src/core/public-page-content.ts';

const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('tenant section defaults preserve existing public experience',()=>{
  assert.deepEqual(parsePublicPageContent(null), DEFAULT_PUBLIC_PAGE);
  for(const key of ['showCatalog','showServices','showCalculator','showContact']){
    assert.equal(DEFAULT_PUBLIC_PAGE[key],true);
  }
});

test('malformed content is ignored, strings bounded and visibility accepts strict booleans only',()=>{
  const long='a'.repeat(9000);
  const parsed=parsePublicPageContent({
    introLabel:long, servicesDescription:long, footerDescription:' Cambio ',
    showCatalog:false,showServices:'false',showContact:0,
    unexpected:'<script>alert(1)</script>',
  });
  assert.equal(parsed.introLabel.length,130);
  assert.equal(parsed.servicesDescription.length,420);
  assert.equal(parsed.footerDescription,'Cambio');
  assert.equal(parsed.showCatalog,false);
  assert.equal(parsed.showServices,true);
  assert.equal(parsed.showContact,true);
  assert.equal('unexpected' in parsed,false);
  assert.equal(validPublicPageContent(parsed),true);
  assert.equal(validPublicPageContent({...parsed,contactTitle:long}),false);
});

test('settings editor is per active organization, permission-scoped, editable and previewable',()=>{
  const s=read('src/modules/settings/SettingsModule.tsx');
  assert.match(s,/const organizationId = activeMembership\?\.organization\.id/);
  assert.match(s,/!can\('settings\.edit'\)/);
  assert.match(s,/\.from\('organization_branding'\)[\s\S]{0,410}\.upsert\(\{/);
  assert.match(s,/organization_id: organizationId/);
  assert.match(s,/public_page_content: publicPage/);
  assert.match(s,/Secciones de tu portal público/);
  assert.match(s,/Vista previa antes de guardar/);
  assert.match(s,/Revisa los límites de texto/);
  assert.match(s,/Subir/);
  assert.match(s,/Bajar/);
});

test('public storefront uses only public catalog and restricts navigation to enabled sections',()=>{
  const app=read('src/App.tsx');
  const hook=read('src/core/use-public-tenant-catalog.ts');
  assert.match(app,/const page = publicCatalog\.brand\?\.publicPage \|\| DEFAULT_PUBLIC_PAGE/);
  assert.match(hook,/publicPage: parsePublicPageContent\(value\.public_page_content\)/);
  assert.match(app,/page\.showCatalog/);
  assert.match(app,/page\.showServices/);
  assert.match(app,/page\.showCalculator/);
  assert.match(app,/page\.showContact/);
  assert.match(app,/page\.catalogTitle/);
  assert.match(app,/page\.servicesDescription/);
  assert.match(app,/page\.contactTitle/);
  assert.match(app,/page\.footerDescription/);
  assert.doesNotMatch(app,/dangerouslySetInnerHTML/);
});

test('SQL migration has single scoped public function and bounded JSON column',()=>{
  const sql=read('supabase/migrations/20261020070000_editable_public_portal_sections.sql');
  assert.equal((sql.match(/^BEGIN;$/gm)||[]).length,1);
  assert.equal((sql.match(/^COMMIT;$/gm)||[]).length,1);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\.tenant_public_catalog/g)||[]).length,1);
  assert.match(sql,/jco_public_page_content_shape/);
  assert.match(sql,/'public_page_content', b\.public_page_content/);
  assert.match(sql,/o\.slug=tenant_slug/);
  assert.match(sql,/jco_private\.operational_access\(o\.id\)/);
  assert.match(sql,/s\.enable_public_website IS TRUE/);
  assert.match(sql,/WHERE organization_id=o\.id AND status='AVAILABLE'/);
});
