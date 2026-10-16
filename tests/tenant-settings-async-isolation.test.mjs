import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const settings=readFileSync(new URL('../src/modules/settings/SettingsModule.tsx',import.meta.url),'utf8');
test('settings cannot mix branding/logo colors across organizations during async operations',()=>{
 assert.match(settings,/const logoSelectionGeneration=useRef\(0\)/);
 assert.match(settings,/\+\+logoSelectionGeneration\.current;\s*setPendingLogo\(null\)/);
 assert.match(settings,/const generation=\+\+logoSelectionGeneration\.current/);
 assert.match(settings,/const issue=await validateAgencyLogoContents\(file\);\s*if\(generation!==logoSelectionGeneration\.current\)return/);
 assert.match(settings,/const palette=await paletteFromLogoFile\(file\);\s*if\(generation!==logoSelectionGeneration\.current\)return/);
 assert.match(settings,/const palette = await paletteFromLogoUrl\(logoUrl\);\s*if\(generation!==logoSelectionGeneration\.current\)return/);
});
test('tenant-specific compliance and licensing queries cannot populate another tenant',()=>{
 assert.match(settings,/if \(!organizationId\) return;\s*let disposed=false/);
 assert.match(settings,/setLicenseType\('SAAS'\)/);
 assert.match(settings,/setWhiteLabelAllowed\(false\)/);
 assert.match(settings,/setCompliance\(\{status:'PENDING'\}\)/);
 assert.match(settings,/\.from\('organization_licenses'\)[\s\S]*?\.then\(\(\{ data \}\) => \{\s*if\(disposed\)return/);
 assert.match(settings,/\.from\('organization_compliance'\)[\s\S]*?\.then\(\(\{ data \}\) => \{\s*if\(disposed\)return/);
 assert.match(settings,/return\(\)=>\{disposed=true;\};\s*\}, \[organizationId\]\)/);
});
