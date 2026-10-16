import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const content=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('DNS ownership proof is never shown from another agency after changing memberships',()=>{
 const s=content('src/modules/settings/AgencyCustomDomainRequest.tsx');
 assert.match(s,/const requestGeneration=useRef\(0\)/);
 assert.match(s,/activeOrganizationRef\.current=organizationId/);
 assert.match(s,/\+\+requestGeneration\.current;\s*setRecord\(null\)/);
 assert.match(s,/return\(\)=>\{disposed=true;\+\+requestGeneration\.current;\}/);
 assert.match(s,/const requestedOrgId=organizationId;\s*const generation=\+\+requestGeneration\.current/);
 assert.match(s,/p_organization_id:requestedOrgId,p_hostname:host/);
 assert.match(s,/generation!==requestGeneration\.current\|\|activeOrganizationRef\.current!==requestedOrgId/);
 assert.ok(s.indexOf('if(generation!==requestGeneration.current||activeOrganizationRef.current!==requestedOrgId)return;') <
  s.indexOf('setRecord(data as DomainRequest);setHostname(data.hostname);'),
  'stale domain request must not show another tenant DNS proof');
});

test('public site enable/disable response belongs only to captured agency',()=>{
 const s=content('src/modules/properties/AgencyPublicSiteControls.tsx');
 assert.match(s,/const operationVersion=useRef\(0\)/);
 assert.match(s,/currentOrganizationRef\.current=organizationId/);
 assert.match(s,/\+\+operationVersion\.current;\s*setSite\(null\)/);
 assert.match(s,/return\(\)=>\{cancelled=true;\+\+operationVersion\.current;\}/);
 assert.match(s,/p_organization_id:requestedOrgId,p_enabled:enabled/);
 assert.match(s,/generation!==operationVersion\.current\|\|currentOrganizationRef\.current!==requestedOrgId/);
 assert.match(s,/setWorking\(false\);setMessage\(''\)/);
});
