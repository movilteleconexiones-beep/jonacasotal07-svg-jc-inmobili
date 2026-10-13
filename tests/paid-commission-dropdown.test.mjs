import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const src=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
test('paid commissions never offer non-paid statuses in dropdown',()=>{
 for(const code of ['PENDING','APPROVED','PAYABLE'])assert.ok(src.includes("row.status!=='PAID'&&<option value=\""+code+"\">"));
 assert.match(src,/row.status==='PAID' && status!=='CANCELLED'/);
 assert.match(src,/if \(corrections\[row.id\]\) await archiveRectifiedCommission\(row\)/);
});
