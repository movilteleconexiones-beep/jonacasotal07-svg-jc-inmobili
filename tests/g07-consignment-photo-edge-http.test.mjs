import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

// G07: real HTTP negative tests only, for the production Edge runtime.
// No keys, JWT, user data, accepted submissions or real photos are used.
// The single TEST agency intake site must stay DISABLED in production.
const endpoint = 'https://cuitgyqrjibgwuniapmk.supabase.co/functions/v1/consignment-photo-upload';
const allowedOrigin = 'https://www.inmojco.com';
const deniedOrigin = 'https://untrusted-g07.example.invalid';

async function request(method, {origin, body} = {}) {
  const headers = origin ? {Origin: origin} : {};
  const response = await fetch(endpoint, {
    method, headers, body, redirect:'error', signal:AbortSignal.timeout(15000),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();
  assert.ok(raw.length < 2000, 'Unexpectedly large HTTP response');
  return {
    code: response.status, allow:response.headers.get('access-control-allow-origin'),
    data:contentType.includes('application/json') ? JSON.parse(raw) : null,
  };
}

function neverLeaks(response) {
  assert.equal(response.data?.uploaded, undefined);
  assert.equal(response.data?.storage_path, undefined);
  assert.equal(response.data?.url, undefined);
}

test('G07: public upload endpoint rejects GET with method_not_allowed', async () => {
  const r = await request('GET',{origin:allowedOrigin});
  assert.equal(r.code,405);
  assert.equal(r.data?.error,'method_not_allowed');
  neverLeaks(r);
});

test('G07: allowlisted CORS preflight succeeds without uploading anything', async () => {
  const r = await request('OPTIONS',{origin:allowedOrigin});
  assert.equal(r.code,200);
  assert.equal(r.allow,allowedOrigin);
  neverLeaks(r);
});

test('G07: hostile CORS preflight is rejected without reflecting origin', async () => {
  const r = await request('OPTIONS',{origin:deniedOrigin});
  assert.equal(r.code,403);
  assert.equal(r.allow,null);
  neverLeaks(r);
});

test('G07: hostile-origin POST is rejected before reading file content', async () => {
  const r = await request('POST',{origin:deniedOrigin,body:'untrusted'});
  assert.equal(r.code,403);
  assert.equal(r.data?.error,'origin_not_allowed');
  assert.equal(r.allow,null);
  neverLeaks(r);
});

function fakePhotoForm(bytes) {
  const form=new FormData();
  form.set('siteSlug','sistema-inmobiliario-jco');
  form.set('requestId',randomUUID());
  form.set('reference','CON-'+randomUUID().toUpperCase());
  form.set('position','0');
  form.set('photo',new Blob([bytes],{type:'image/png'}),'qa-g07.png');
  return form;
}

test('G07: malformed PNG signature rejected before storage access', async () => {
  const r=await request('POST',{origin:allowedOrigin,body:fakePhotoForm(new Uint8Array([1,2,3,4,5,6,7,8]))});
  assert.equal(r.code,415);
  assert.equal(r.data?.error,'invalid_file_signature');
  neverLeaks(r);
});

test('G07: PNG signature cannot bypass disabled QA intake/unknown submission', async () => {
  const pngMagic=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
  const r=await request('POST',{origin:allowedOrigin,body:fakePhotoForm(pngMagic)});
  assert.equal(r.code,404);
  assert.equal(r.data?.error,'submission_unavailable');
  neverLeaks(r);
});
