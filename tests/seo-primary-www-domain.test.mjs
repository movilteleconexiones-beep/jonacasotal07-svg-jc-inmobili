import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = src('index.html');
const caddy = src('Caddyfile');
const robots = src('public/robots.txt');
const sitemap = src('public/sitemap.xml');

test('search metadata advertises INMOJCO, never the historical JCO test tenant', () => {
  assert.match(html, /<title>INMOJCO \| Software inmobiliario<\/title>/);
  assert.match(html, /<meta property="og:title" content="INMOJCO/);
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.inmojco\.com\/"\s*\/>/);
  assert.doesNotMatch(html, /<title>Sistema Inmobiliario JCO<\/title>/);
  assert.doesNotMatch(html, /(?:app\.inmojco\.com|https?:\/\/inmojco\.com\/)/);
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
