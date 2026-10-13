import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const src=readFileSync(new URL('../src/modules/reports/MonthlyAccountingReport.tsx',import.meta.url),'utf8');
test('owner net preview subtracts only newly approved deductions',()=>{
 assert.match(src,/deductedByStatement/);
 assert.match(src,/saved-\(approved-alreadyIncluded\)/);
 assert.match(src,/entry.status!=='DRAFT'/);
 assert.match(src,/Neto estimado con deducciones aprobadas/);
});
test('stale owner net cannot be exported as an official recorded balance',()=>{
 assert.match(src,/staleCount>0&&selection.kind==='metric'&&selection.key==='OWNER_NET'/);
});
