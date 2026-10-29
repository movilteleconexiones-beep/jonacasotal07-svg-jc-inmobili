import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const s=readFileSync(new URL('../server/wompi-runtime.ts',import.meta.url),'utf8');
test('Wompi readiness independently tests private Supabase storage without leaking errors',()=>{
 assert.match(s,/app\.get\('\/healthz'/);
 assert.match(s,/app\.get\('\/readyz'/);
 assert.match(s,/client\.from\('payment_orders'\)\.select\('id'\)\.limit\(0\)/);
 assert.match(s,/res\.status\(503\)\.json\(\{ status: 'unavailable' \}\)/);
 assert.match(s,/WOMPI_PRODUCTION_APPROVED/);
 assert.match(s,/createWompiTransactionLookup\(process\.env\.WOMPI_PRIVATE_KEY\?\.trim\(\)\)/);
 assert.doesNotMatch(s,/VITE_WOMPI_PRIVATE_KEY/);
});
