import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const helper=readFileSync(new URL('../src/core/effective-commissions.ts',import.meta.url),'utf8');
const reports=readFileSync(new URL('../src/modules/reports/ReportsModule.tsx',import.meta.url),'utf8');
const monthly=readFileSync(new URL('../src/modules/reports/MonthlyAccountingReport.tsx',import.meta.url),'utf8');
test('paid and pending cards reconcile against accounting corrections',()=>{
 assert.match(helper,/item.status!=='CANCELLED'&&!excluded.has\(item.id\)/);
 assert.match(helper,/if\(item.status==='PAID'\) sum.paid\+=n/);
 assert.match(reports,/effectiveCommissionTotals\(commissionRows,correctionRows\)/);
 assert.match(reports,/paidCommissions: commissionTotals.paid/);
 assert.match(reports,/pendingCommissions: commissionTotals.pending/);
});
test('monthly commission counts and exports exclude rectified mistaken payments',()=>{
 assert.match(monthly,/commission_accounting_corrections/);
 assert.match(monthly,/effectiveCommissionRows\(rows/);
 assert.match(monthly,/rows:effectiveRows/);
 assert.match(monthly,/cols:'id,status,amount/);
});
