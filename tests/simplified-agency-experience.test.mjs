import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTenantSlug, tenantPrivatePath } from '../src/core/tenant-links.ts';
import { tenantPublicPath } from '../src/core/public-tenant-route.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('registration automatically creates agency link without showing technical inputs', () => {
  const registration = read('src/components/OrganizationRegistration.tsx');
  assert.match(registration, /if \(!slugEdited\) setSlug\(normalizeTenantSlug\(e\.target\.value\)\)/);
  assert.match(registration, /showUrlOptions && \(/);
  assert.match(registration, /Opciones de enlace \(opcional\)/);
  assert.match(registration, /setShowUrlOptions\(true\)/);
  assert.match(registration, /createOrganization\(cleanName, cleanSlug, country\)/);
  assert.match(registration, /Continuar a planes y pago/);
  assert.equal(tenantPrivatePath('inmobiliaria-la-palmera'), '/app?inmobiliaria=inmobiliaria-la-palmera');
  assert.equal(tenantPublicPath('inmobiliaria-la-palmera'), '/inmobiliaria/inmobiliaria-la-palmera');
  assert.equal(normalizeTenantSlug('Inmobiliaria La Palmera'), 'inmobiliaria-la-palmera');
});

test('advanced options remain editable but hidden by default, while public link is available', () => {
  const settings = read('src/modules/settings/SettingsModule.tsx');
  assert.match(settings, /Personaliza tu inmobiliaria/);
  assert.match(settings, /Tu enlace público/);
  assert.match(settings, /<details className="md:col-span-2/);
  assert.match(settings, /Opciones avanzadas \(opcionales\)/);
  assert.match(settings, /savePublicSlug\(\)/);
  assert.match(settings, /isOwner \|\| !can\('settings\.edit'\)/);
  assert.match(settings, /public_page_content: publicPage/);
  assert.match(settings, /logo_url:/);
  assert.match(settings, /Guardar configuración/);
  assert.match(settings, /website: website\.trim\(\)/);
});

test('workbench separates basic from advanced modules without changing permissions', () => {
  const dashboard = read('src/modules/dashboard/PrivateDashboard.tsx');
  assert.match(dashboard, /secondaryMenu = new Set<string>/);
  assert.match(dashboard, /Trabajo diario/);
  assert.match(dashboard, /Administración y ajustes/);
  assert.match(dashboard, /menuItems\.filter\(item => !secondaryMenu\.has\(item\.id\)\)/);
  assert.match(dashboard, /menuItems\.filter\(item => secondaryMenu\.has\(item\.id\)\)/);
  assert.match(dashboard, /disabled=\{!item\.available\}/);
  assert.match(dashboard, /navigateToOperationalPanel\(item\.id\)/);
  assert.match(dashboard, /Más opciones/);
  assert.match(dashboard, /tenantPrivatePath\(activeMembership\.organization\.slug\)/);
});

test('first-run guide becomes actionable and disappears after meaningful data exists', () => {
  const dashboard = read('src/modules/dashboard/PrivateDashboard.tsx');
  assert.match(dashboard, /const isNewAgency = !loading && stats\.properties === 0 && stats\.contacts === 0/);
  assert.match(dashboard, /\{isNewAgency && firstActions\.length > 0 && \(/);
  assert.match(dashboard, /Personalizar marca/);
  assert.match(dashboard, /Registrar un inmueble/);
  assert.match(dashboard, /Agregar un cliente/);
  assert.match(dashboard, /\.filter\(action => action\.allowed\)/);
  assert.match(dashboard, /onNavigate\(action\.target\)/);
});
