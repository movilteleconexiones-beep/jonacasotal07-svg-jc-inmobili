import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const query=readFileSync(new URL('../security/tests/wompi_release_readiness.sql',import.meta.url),'utf8');
test('Wompi release checks actual DB function and service privileges, read only',()=>{
 assert.match(query,/process_verified_payment_event\(text,text,bigint,text,text,text,text,text\)/);
 assert.match(query,/has_function_privilege\('service_role'/);
 assert.match(query,/has_function_privilege\('anon'/);
 assert.doesNotMatch(query,/\b(CREATE|ALTER|DROP|DELETE|UPDATE|INSERT|GRANT|REVOKE|TRUNCATE)\s+(TABLE|FUNCTION|INTO|FROM|ON)/i);
});
