import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const settings=readFileSync(new URL('../src/modules/settings/SettingsModule.tsx',import.meta.url),'utf8');

test('tenant switch invalidates pending settings saves and prevents stale UI state',()=>{
  assert.match(settings,/const saveGeneration=useRef\(0\)/);
  assert.match(settings,/activeOrganizationIdRef\.current=organizationId/);
  assert.match(settings,/\+\+saveGeneration\.current;\s*setPendingLogo\(null\)/);
  assert.match(settings,/return\(\)=>\{\+\+logoSelectionGeneration\.current;\+\+saveGeneration\.current;\}/);
  assert.match(settings,/const targetOrganizationId=organizationId;\s*const generation=\+\+saveGeneration\.current/);
  assert.match(settings,/activeOrganizationIdRef\.current===targetOrganizationId/);
  assert.match(settings,/if\(!isCurrent\(\)\)return;\s*window\.dispatchEvent/);
  assert.match(settings,/if\(isCurrent\(\)\)setSaving\(false\)/);
});

test('logo is only rolled back when it was not persisted to branding',()=>{
  assert.match(settings,/brandingPersisted=!brandingResult\.error/);
  assert.match(settings,/if\(uploadedLogo&&!brandingPersisted\)await rollbackAgencyLogoUpload\(uploadedLogo\.path\)/);
  assert.doesNotMatch(settings,/if\(error\)\s*\{\s*if\(uploadedLogo\)await rollbackAgencyLogoUpload/);
  assert.match(settings,/if\(brandingPersisted\)\s*\{\s*setPendingLogo\(null\)/);
  assert.match(settings,/El guardado fue parcial o falló/);
});

test('server writes and country operation target captured tenant rather than latest selection',()=>{
  assert.match(settings,/target_org:targetOrganizationId/);
  assert.match(settings,/\.eq\('id',targetOrganizationId\)/);
  assert.match(settings,/organization_id:targetOrganizationId/g);
  assert.match(settings,/\.eq\('organization_id',targetOrganizationId\)/);
  assert.match(settings,/if\(!isCurrent\(\)\)\s*\{\s*if\(uploadedLogo\)await rollbackAgencyLogoUpload/);
});
