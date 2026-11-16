import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';

// G26: real anonymous HTTP safety, no accepted uploads and no personal data.
// Default URL is deliberately the isolated Supabase clone.
const projectRef='zjgstfgiirgjssnihaam';
const base=process.env.G26_EDGE_BASE_URL||('https://'+projectRef+'.supabase.co/functions/v1');
const official='https://www.inmojco.com';
const hostile='https://external-g26.invalid';

async function call(name,method,{origin,body}={}){
  const response=await fetch(base+'/'+name,{
    method,
    headers:{...(origin?{Origin:origin}:{})},
    ...(body?{body}:{}),
    redirect:'error',
    signal:AbortSignal.timeout(18000),
  });
  const text=await response.text();
  assert.ok(text.length<1800,name+': unexpected response length');
  return {status:response.status,cors:response.headers.get('access-control-allow-origin'),text};
}
test('G26 clone: public photo upload rejects an unapproved origin before any bytes',async()=>{
  const r=await call('consignment-photo-upload','POST',{origin:hostile,body:'forbidden'});
  assert.equal(r.status,403);
  assert.equal(r.cors,null);
  assert.match(r.text,/origin_not_allowed/);
});
test('G26 clone: allowed upload preflight and unsupported GET have expected boundaries',async()=>{
  const preflight=await call('consignment-photo-upload','OPTIONS',{origin:official});
  assert.equal(preflight.status,200);
  assert.equal(preflight.cors,official);
  const get=await call('consignment-photo-upload','GET',{origin:official});
  assert.equal(get.status,405);
  assert.match(get.text,/method_not_allowed/);
});
test('G26 clone: retired app subdomain receives no CORS permission',async()=>{
  for(const name of ['consignment-photo-upload','consignment-photo-review']){
    const r=await call(name,'OPTIONS',{origin:'https://app.inmojco.com'});
    assert.notEqual(r.status,200);
    assert.notEqual(r.cors,'https://app.inmojco.com');
  }
});
test('G26 clone: unauthenticated review cannot return signed URLs',async()=>{
  const r=await call('consignment-photo-review','POST',{
    origin:official,
    body:JSON.stringify({consignmentId:randomUUID()}),
  });
  assert.ok([401,403].includes(r.status),'unauthenticated review must be denied, got '+r.status);
  assert.doesNotMatch(r.text,/signedURL|signedUrl|photos":\[/i);
});
test('G26 clone: well-formed public image without accepted submission is rejected',async()=>{
  const f=new FormData();
  f.set('siteSlug','sistema-inmobiliario-jco');
  f.set('requestId',randomUUID());
  f.set('reference','CON-'+randomUUID().toUpperCase());
  f.set('position','0');
  f.set('photo',new Blob([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])],{type:'image/png'}),'qa.png');
  const r=await call('consignment-photo-upload','POST',{origin:official,body:f});
  assert.equal(r.status,404);
  assert.match(r.text,/submission_unavailable/);
});
