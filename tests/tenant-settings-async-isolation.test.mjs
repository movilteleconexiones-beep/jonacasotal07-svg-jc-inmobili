import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const settings=readFileSync(new URL('../src/modules/settings/SettingsModule.tsx',import.meta.url),'utf8');
test('settings cannot mix branding/logo colors across organizations during async operations',()=>{
 assert.match(settings,/const logoSelectionGeneration=useRef\(0\)/);
 assert.match(settings,/\+\+logoSelectionGeneration\.current;\s*\+\+saveGeneration\.current;\s*setPendingLogo\(null\)/);
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

test('remote URL palette selection clears superseded file choice and loading state',()=>{
 const match=settings.match(/async function adaptLogoColors\(\) \{([\s\S]*?)async function save\(/);
 assert.ok(match,'remote palette flow must exist');
 assert.match(match[1],/const generation=\+\+logoSelectionGeneration\.current/);
 assert.match(match[1],/setPendingLogo\(null\)/);
 assert.match(match[1],/setAnalyzingFile\(false\)/);
 assert.match(match[1],/if\(generation!==logoSelectionGeneration\.current\)return/);
});
