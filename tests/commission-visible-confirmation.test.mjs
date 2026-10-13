import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const src=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
test('finance controls verify the new server state before claiming success',()=>{
 assert.match(src,/async function verifyCommissionStatus/);
 assert.match(src,/data.status!==expected/);
 for (const state of ["status","'CANCELLED'","'PENDING'"]) assert.ok(src.includes('verifyCommissionStatus(row.id,'+state+')'));
 assert.match(src,/setRows\(previous=>previous.map/);
 assert.match(src,/Confirmado en Supabase/);
});
