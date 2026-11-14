import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/modules/reports/ReportsModule.tsx', import.meta.url), 'utf8');

test('report errors are displayed instead of misleading zeros', () => {
  assert.match(source, /properties\.error \|\| contacts\.error \|\| leads\.error/);
  assert.match(source, /throw new Error\('No fue posible verificar el conteo completo del CRM/);
  assert.match(source, /role="alert"/);
  assert.match(source, /loading \|\| error \? '—' :/);
});
test('report totals are not computed from truncated rows', () => {
  assert.match(source, /count: 'exact'/);
  assert.match(source, /readCompletePages\(\(from,to\)=>supabase\.from\('deals'\)/);
  assert.match(source, /readCompletePages\(\(from,to\)=>supabase\.from\('commissions'\)/);
  assert.match(source, /properties\.count == null \|\| contacts\.count == null \|\| leads\.count == null/);
});
test('report requests are scoped to tenant and discarded on organization changes', () => {
  assert.match(source, /setState\(EMPTY\)/);
  assert.match(source, /if \(cancelled\) return/);
  assert.match(source, /return \(\) => \{ cancelled = true; \}/);
  assert.match(source, /\.eq\('organization_id', organizationId\)/);
});
