import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = src('index.html');
const caddy = src('Caddyfile');
const robots = src('public/robots.txt');
const sitemap = src('public/sitemap.xml');

test('search metadata uses Sistema Inmobiliario JCO at the official www domain', () => {
  assert.match(html, /<title>Sistema Inmobiliario JCO \| Software inmobiliario<\/title>/);
  assert.match(html, /<meta name="description" content="Sistema Inmobiliario JCO:/);
  assert.match(html, /<meta property="og:title" content="Sistema Inmobiliario JCO/);
  assert.match(html, /<meta property="og:site_name" content="Sistema Inmobiliario JCO"/);
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.inmojco\.com\/"\s*\/>/);
  assert.doesNotMatch(html, /(?:app\.inmojco\.com|https?:\/\/inmojco\.com\/)/);

  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLd, 'Website structured data is present');
  const site = JSON.parse(jsonLd[1]);
  assert.equal(site['@type'], 'WebSite');
  assert.equal(site.name, 'Sistema Inmobiliario JCO');
  assert.equal(site.url, 'https://www.inmojco.com/');
  assert.ok(site.alternateName.includes('INMOJCO'));
});

test('public root uses commercial name without changing individual agency branding', () => {
  const app = src('src/App.tsx');
  assert.match(app, /const PUBLIC_COMMERCIAL_NAME = 'Sistema Inmobiliario JCO';/);
  assert.match(app, /tenantSlug \? 'Portal inmobiliario' : PUBLIC_COMMERCIAL_NAME/);
  assert.match(app, /document\.title = tenantSlug && publicCatalog\.brand/);
  assert.match(app, /companyName: publicCatalog\.brand\?\.companyName \|\| fallbackCompanyName/);
});

test('only canonical public homepage is declared in sitemap', () => {
  assert.match(sitemap, /<loc>https:\/\/www\.inmojco\.com\/<\/loc>/);
  assert.doesNotMatch(sitemap, /<loc>[^<]*(?:\/app|\/super-admin|app\.inmojco\.com)/);
  assert.match(robots, /Sitemap: https:\/\/www\.inmojco\.com\/sitemap\.xml/);
  // Google must be able to crawl private paths to discover their noindex header.
  assert.doesNotMatch(robots, /Disallow:\s*\/(?:app|super-admin)/i);
});

test('Caddy declares redirects from legacy hosts, but preserves private login routes', () => {
  assert.match(caddy, /@legacyDomains host inmojco\.com app\.inmojco\.com/);
  assert.match(caddy, /redir @legacyDomains https:\/\/www\.inmojco\.com\{uri\} 308/);
  assert.match(caddy, /@publicHomepage path \//);
  assert.match(caddy, /@privateRoutes path \/app \/app\/\* \/super-admin \/super-admin\/\*/);
  assert.match(caddy, /header @privateRoutes X-Robots-Tag "noindex, nofollow, noarchive"/);
  assert.match(caddy, /@billingReturn query billing=return/);
  assert.match(caddy, /header @billingReturn X-Robots-Tag "noindex, nofollow, noarchive"/);
  assert.match(caddy, /handle \{[\s\S]*?try_files \{path\} \/index\.html/);
});
