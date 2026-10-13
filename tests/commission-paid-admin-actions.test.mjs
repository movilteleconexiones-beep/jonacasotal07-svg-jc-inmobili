import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const s=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
test('administrator can request rectification and recover archived item',()=>{
 assert.match(s,/value="REQUEST_CORRECTION"/);
 assert.match(s,/value="RESTORE_REPLACEMENT"/);
 assert.match(s,/await replaceArchivedCommission\(row\)/);
 assert.match(s,/row.status==='PAID' && status!=='CANCELLED'/);
});