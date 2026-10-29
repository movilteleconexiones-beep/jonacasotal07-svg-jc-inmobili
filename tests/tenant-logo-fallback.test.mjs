import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const component = readFileSync(new URL('../src/components/TenantLogo.tsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/modules/dashboard/PrivateDashboard.tsx', import.meta.url), 'utf8');

test('missing or failing logo falls back to a scoped agency icon', () => {
  assert.match(component, /if \(!usableSrc \|\| usableSrc === failedSrc\)/);
  assert.match(component, /onError=\{\(\) => setFailedSrc\(usableSrc\)\}/);
  assert.match(component, /aria-label=\{\`Logotipo no disponible de \$\{organizationName\}\`\}/);
  assert.match(component, /referrerPolicy="no-referrer"/);
});

test('logo failure in one tenant does not persist when its src changes', () => {
  assert.match(component, /usableSrc === failedSrc/);
  assert.doesNotMatch(component, /if \(failedSrc\)/);
});

test('operational and private portal headers use image fallback', () => {
  const occurrences = dashboard.match(/<TenantLogo src=\{logoUrl\} organizationName=\{activeMembership\.organization\.name\} \/>/g) ?? [];
  assert.equal(occurrences.length, 2);
  assert.doesNotMatch(dashboard, /\{logoUrl \? <img src=\{logoUrl\}/);
});
