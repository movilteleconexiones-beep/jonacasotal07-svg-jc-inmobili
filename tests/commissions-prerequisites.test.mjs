import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx', import.meta.url), 'utf8');

test('commission form requires a deal and validates tenant-scoped references', () => {
  assert.match(source, /!can\(PERMISSIONS\.COMMISSIONS_CREATE\)/);
  assert.match(source, /loadingOptions \|\| deals\.length === 0/);
  assert.match(source, /deals\.some\(\(deal\) => deal\.id === selectedDealId\)/);
  assert.match(source, /members\.some\(\(member\) => member\.user_id === beneficiaryId\)/);
  assert.match(source, /disabled=\{loadingOptions \|\| deals\.length === 0\}/);
  assert.match(source, /Primero crea un negocio en la sección Negocios/);
});

test('tenant switch and query failures clear old commission choices', () => {
  assert.match(source, /setRows\(\[\]\); setDeals\(\[\]\); setMembers\(\[\]\)/);
  assert.match(source, /setDeals\(dealsResult\.error \? \[\]/);
  assert.match(source, /if \(membersResult\.error\) \{ setMembers\(\[\]\);/);
});

test('paid status requires confirmation and corrects payment timestamp on reopening', () => {
  assert.match(source, /!can\(PERMISSIONS\.COMMISSIONS_EDIT\)/);
  assert.match(source, /status === 'PAID' && !window\.confirm/);
  assert.match(source, /patch\.paid_at = status === 'PAID' \? new Date\(\)\.toISOString\(\) : null/);
  assert.match(source, /\.update\(patch\)\.eq\('id', row\.id\)\.eq\('organization_id', organizationId\)/);
});

test('stale requests cannot replace rows when switching organizations', () => {
  assert.match(source, /const loadVersion = useRef\(0\)/);
  assert.match(source, /const version = \+\+loadVersion\.current/);
  assert.match(source, /if \(version !== loadVersion\.current\) return/);
  assert.match(source, /return \(\) => \{ \+\+loadVersion\.current; \}/);
});
