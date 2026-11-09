import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Public, read-only end-to-end check of the LIVE Railway/Vite application.
 *
 * The Railway OAuth connector only exposes environment variable NAMES.
 * This probe checks the public build's embedded Supabase project URL without
 * printing, loading, or comparing any credential or private record.
 */
const CANONICAL = new URL('https://www.inmojco.com/');
const EXPECTED_PROJECT_REF = 'cuitgyqrjibgwuniapmk';
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

async function publicGet(url) {
  const target = new URL(url, CANONICAL);
  assert.equal(target.origin, CANONICAL.origin, 'Never request a foreign host');

  const response = await fetch(target, {
    redirect: 'manual',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15000),
  });

  assert.equal(response.status, 200, `${target.pathname} must return HTTP 200 on canonical HTTPS`);
  assert.equal(new URL(response.url).origin, CANONICAL.origin, 'Request must stay on canonical www');
  const data = await response.arrayBuffer();
  assert.ok(data.byteLength > 0 && data.byteLength <= MAX_RESPONSE_BYTES,
    'Unexpectedly empty or large public response');
  return {
    contentType: response.headers.get('content-type') || '',
    body: new TextDecoder().decode(data),
  };
}

test('www production serves the homepage, /app and Wompi callback as SPA HTML', async () => {
  for (const route of ['/', '/app', '/?billing=return']) {
    const result = await publicGet(route);
    assert.match(result.contentType, /text\/html/i);
    assert.match(result.body, /<html\b/i);
    assert.match(result.body, /<script\b/i);
  }
});

test('public LIVE JavaScript is bound exclusively to the active Supabase production project', async () => {
  const { body: html } = await publicGet('/');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map(([, path]) => new URL(path, CANONICAL))
    .filter(url => url.origin === CANONICAL.origin && url.pathname.endsWith('.js'));

  assert.ok(scripts.length > 0, 'No same-origin JavaScript bundle found');
  assert.ok(scripts.length <= 8, 'Unexpected number of script entry points');

  const refs = new Set();
  for (const script of scripts) {
    const { contentType, body } = await publicGet(script);
    assert.match(contentType, /(?:javascript|text\/plain)/i);
    for (const [, ref] of body.matchAll(/https?:\/\/([a-z0-9]{20})\.supabase\.co\b/g)) {
      refs.add(ref);
    }
  }

  assert.deepEqual([...refs], [EXPECTED_PROJECT_REF],
    'Production browser bundle references an unexpected Supabase project');
  // Only the public project ref is printed; never log compiled JS or keys.
  console.log('PASS: public WWW app points only to expected Supabase project ref');
});
