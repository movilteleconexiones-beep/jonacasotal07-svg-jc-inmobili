import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DASHBOARD_SHORTCUTS, permittedDashboardShortcuts } from '../src/core/dashboard-shortcuts.ts';
import { tenantMenu } from '../src/core/tenant-menu.ts';

const source = readFileSync(new URL('../src/modules/dashboard/PrivateDashboard.tsx', import.meta.url), 'utf8');

test('all five home counters navigate to their matching operating panels', () => {
  assert.deepEqual(
    DASHBOARD_SHORTCUTS.map(({label,metric,target}) => ({label,metric,target})),
    [
      { label: 'Propiedades', metric: 'properties', target: 'PROPERTIES' },
      { label: 'Clientes', metric: 'contacts', target: 'CONTACTS' },
      { label: 'Leads', metric: 'leads', target: 'LEADS' },
      { label: 'Citas y visitas', metric: 'appointments', target: 'APPOINTMENTS' },
      { label: 'Negocios', metric: 'deals', target: 'DEALS' },
    ],
  );
  for (const { target } of DASHBOARD_SHORTCUTS) {
    assert.ok(tenantMenu(() => true, false, false).find(item => item.id === target)?.available);
    assert.match(source, new RegExp("view === '" + target + "'[\\s\\S]*?&& <[A-Z][A-Za-z]+Module"));
  }
});

test('dashboard cards honor the same permission matrix as the sidebar', () => {
  assert.equal(permittedDashboardShortcuts(() => false).length, 0);
  assert.deepEqual(permittedDashboardShortcuts(p => p === 'deals.view').map(x => x.target), ['DEALS']);
  assert.deepEqual(permittedDashboardShortcuts(p => ['properties.view','appointments.view'].includes(p))
    .map(x => x.target), ['PROPERTIES','APPOINTMENTS']);
  assert.equal(permittedDashboardShortcuts(() => true).length, 5);
});

test('cards use an actual button, accessible label, visible navigation affordance and guarded action', () => {
  assert.match(source, /const cards = permittedDashboardShortcuts\(can\)/);
  assert.match(source, /const destination = menuItems\.find\(item => item\.id === target\)/);
  assert.match(source, /if \(!destination\?\.available\) return/);
  assert.match(source, /onNavigate=\{navigateToOperationalPanel\}/);
  assert.match(source, /onClick=\{\(\) => navigateToOperationalPanel\(item\.id\)\}/);
  assert.match(source, /onClick=\{\(\) => onNavigate\(card\.target\)\}/);
  assert.match(source, /aria-label=\{`Abrir panel de \$\{card\.label\}`\}/);
  assert.match(source, /Abrir panel <ArrowUpRight/);
  assert.match(source, /focus-visible:ring-2/);
});

test('returning to Inicio refreshes metric counts without changing tenant boundaries', () => {
  assert.match(source, /if \(view !== 'DASHBOARD'\) return/);
  assert.match(source, /\}, \[organizationId, can, view, clientPortalMode, mode\.clientLinkedRole\]\)/);
  assert.match(source, /\.from\('deals'\)\.select\('id', \{ count: 'exact', head: true \}\)\.eq\('organization_id', organizationId\)/);
});
