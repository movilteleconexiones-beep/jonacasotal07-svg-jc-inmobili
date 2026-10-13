import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const src=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
test('administrator selector includes Anular and routes to appropriate audited operation',()=>{
 assert.match(src,/status==='CANCELLED'/);
 assert.match(src,/if \(corrections\[row.id\]\) await archiveRectifiedCommission\(row\)/);
 assert.match(src,/else if \(row.status==='PAID'\)/);
 assert.match(src,/else await cancelCommission\(row\)/);
 assert.match(src,/Anular \{corrections\[row.id\]/);
 assert.match(src,/row.status !== 'PAID' \|\| \(isCommissionAdministrator/);
});
