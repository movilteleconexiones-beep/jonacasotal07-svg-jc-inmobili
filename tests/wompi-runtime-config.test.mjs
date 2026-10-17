import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateWompiRuntimeConfig,
  INMOJCO_PRODUCTION_SUPABASE_URL,
} from '../server/wompi-runtime-config.ts';

const serverSource = readFileSync(new URL('../server/wompi-runtime.ts', import.meta.url), 'utf8');
const validSandbox = () => ({
  WOMPI_ENV: 'sandbox',
  SUPABASE_URL: INMOJCO_PRODUCTION_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-server-role-key-valid-for-tests-only',
  WOMPI_EVENTS_SECRET: 'dummy-events-secret-valid-for-tests-only',
  PORT: '8080',
});

test('a valid sandbox configuration parses without opening a port', () => {
  assert.deepEqual(validateWompiRuntimeConfig(validSandbox()), {
    environment: 'sandbox',
    supabaseUrl: INMOJCO_PRODUCTION_SUPABASE_URL,
    serviceRoleKey: validSandbox().SUPABASE_SERVICE_ROLE_KEY,
    eventsSecret: validSandbox().WOMPI_EVENTS_SECRET,
    port: 8080,
  });
  assert.match(serverSource, /validateWompiRuntimeConfig\(\)/);
  assert.ok(serverSource.indexOf('validateWompiRuntimeConfig()') <
    serverSource.indexOf('createClient(supabaseUrl, serviceRoleKey'));
  assert.ok(serverSource.indexOf('validateWompiRuntimeConfig()') <
    serverSource.indexOf('app.listen(port'));
});

test('the exact missing Railway Wompi secret blocks startup without leaking keys', () => {
  const conf=validSandbox();
  delete conf.WOMPI_EVENTS_SECRET;
  const secret='dummy-server-role-key-valid-for-tests-only';
  assert.throws(() => validateWompiRuntimeConfig(conf), (error) => {
    assert.match(error.message, /Missing required server environment variable: WOMPI_EVENTS_SECRET/);
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  });
});

test('placeholder or identical secret values are not accepted for webhook verification', () => {
  for (const bad of ['replace-me','change_me','demo','placeholder','your-secret','short']) {
    const c=validSandbox();c.WOMPI_EVENTS_SECRET=bad;
    assert.throws(() => validateWompiRuntimeConfig(c), /Invalid required server secret: WOMPI_EVENTS_SECRET/);
  }
  const identical=validSandbox();
  identical.WOMPI_EVENTS_SECRET=identical.SUPABASE_SERVICE_ROLE_KEY;
  assert.throws(() => validateWompiRuntimeConfig(identical), /must be different/);
});

test('Wompi production requires both explicit approval and the exact original INMOJCO database', () => {
  const conf={...validSandbox(), WOMPI_ENV:'production'};
  assert.throws(() => validateWompiRuntimeConfig(conf), /WOMPI_PRODUCTION_APPROVED=1/);
  conf.WOMPI_PRODUCTION_APPROVED='1';
  conf.SUPABASE_URL='https://nqzopzhmhqdssgpljypu.supabase.co';
  assert.throws(() => validateWompiRuntimeConfig(conf), /official INMOJCO Supabase project/);
  conf.SUPABASE_URL=INMOJCO_PRODUCTION_SUPABASE_URL;
  assert.equal(validateWompiRuntimeConfig(conf).environment,'production');
});

test('invalid Supabase host and ports fail closed without network or secret disclosure', () => {
  for (const url of [
    'http://cuitgyqrjibgwuniapmk.supabase.co',
    'https://example.com',
    'https://cuitgyqrjibgwuniapmk.supabase.co/anything',
  ]) {
    const c=validSandbox(); c.SUPABASE_URL=url;
    assert.throws(()=>validateWompiRuntimeConfig(c),/SUPABASE_URL must be/);
  }
  for(const port of ['0','-1','65536','abc']) {
    const c=validSandbox();c.PORT=port;
    assert.throws(()=>validateWompiRuntimeConfig(c),/PORT must be/);
  }
});
