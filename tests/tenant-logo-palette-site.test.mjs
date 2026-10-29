import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extractTenantPalette, safeBrandUrl, safeTenantColor,
  TENANT_DEFAULT_PRIMARY, TENANT_DEFAULT_SECONDARY,
} from '../src/core/tenant-palette.ts';

const dashboard = readFileSync(new URL('../src/modules/dashboard/PrivateDashboard.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/modules/settings/SettingsModule.tsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../src/core/use-tenant-branding.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('identifies an accessible primary and pale secondary for a saturated logo', () => {
  const pixels = new Uint8ClampedArray(96 * 96 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 244; pixels[i + 1] = 40; pixels[i + 2] = 42; pixels[i + 3] = 255;
  }
  const palette = extractTenantPalette(pixels);
  assert.match(palette.primary, /^#[0-9a-f]{6}$/);
  assert.match(palette.secondary, /^#[0-9a-f]{6}$/);
  const rgb = [1, 3, 5].map(x => parseInt(palette.primary.slice(x, x + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  assert.ok(1.05 / (luminance + 0.05) >= 4.5, 'white text must stay legible');
});

test('rejects transparent and unidentifiable logos rather than inventing colors', () => {
  const pixels = new Uint8ClampedArray(64);
  assert.throws(() => extractTenantPalette(pixels), /El logo no contiene un color/);
});

test('website and logo fields only accept safe HTTPS URLs', () => {
  assert.equal(safeBrandUrl('https://ejemplo.com/logo.png'), 'https://ejemplo.com/logo.png');
  for (const url of ['javascript:alert(1)', 'http://ejemplo.com', 'data:image/svg+xml,evil', '//ejemplo.com', 'https://user:pass@ejemplo.com']) {
    assert.equal(safeBrandUrl(url), null);
  }
  assert.equal(safeTenantColor('not-a-color', TENANT_DEFAULT_PRIMARY), TENANT_DEFAULT_PRIMARY);
  assert.equal(safeTenantColor('#Aa12CC', TENANT_DEFAULT_SECONDARY), '#aa12cc');
});

test('agency dashboard remains isolated and public storefront uses explicit tenant scope', () => {
  // Agency legal/tenant identity must never be replaced by editable brand copy.
  assert.match(dashboard, /<TenantLogo src=\{logoUrl\} organizationName=\{activeMembership\.organization\.name\} \/>/);
  assert.match(readFileSync(new URL('../src/components/TenantLogo.tsx', import.meta.url), 'utf8'), /alt=\{\`Logo de \$\{organizationName\}\`\}/);
  assert.match(dashboard, /aria-label="Inmobiliaria activa"/);
  assert.match(dashboard, /Sitio web de la inmobiliaria/);
  assert.match(dashboard, /tenantPrimary/);
  assert.match(dashboard, /tenantSecondary/);
  assert.match(dashboard, /isPlatformAdmin && <a href="\/super-admin"/);
  assert.match(app, /href="\/super-admin"/);
  // The platform storefront defaults to softwareBrand; a selected tenant
  // receives only its own public catalogue and branding from the scoped RPC.
  assert.match(app, /publicCatalog\.brand \? publicCompanyName : softwareBrand/);
  assert.match(app, /usePublicTenantCatalog\(tenantSlug\)/);
  assert.match(app, /const tenantPrimary = safeTenantColor\(branding\.primaryColor, TENANT_DEFAULT_PRIMARY\)/);
});

test('palette write is limited to the active tenant and settings.edit permission', () => {
  assert.match(dashboard, /can\(PERMISSIONS\.SETTINGS_EDIT\)/);
  assert.match(dashboard, /from\('organization_branding'\)\.upsert\(\{/);
  assert.match(dashboard, /organization_id: organizationId/);
  assert.match(dashboard, /onConflict: 'organization_id'/);
  assert.match(settings, /logo_url: logoUrl\.trim\(\) \? safeBrandUrl\(logoUrl\) : null/);
  assert.match(settings, /primary_color: safeTenantColor\(primaryColor, TENANT_DEFAULT_PRIMARY\)/);
  assert.match(settings, /secondary_color: safeTenantColor\(secondaryColor, TENANT_DEFAULT_SECONDARY\)/);
  assert.match(settings, /El sitio web debe empezar por https/);
  assert.match(settings, /verificar su propiedad, DNS y certificado HTTPS/);
});

test('switching organizations rejects slow stale branding loads', () => {
  assert.match(hook, /const version = \+\+loadVersion\.current/);
  assert.match(hook, /if \(version !== loadVersion\.current\) return/);
  assert.match(hook, /setBranding\(\{ \.\.\.DEFAULTS, companyName:/);
  assert.match(hook, /\+\+loadVersion\.current;\s*window\.removeEventListener/);
});
