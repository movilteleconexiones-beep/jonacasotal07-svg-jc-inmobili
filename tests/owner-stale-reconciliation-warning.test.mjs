import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const helper=readFileSync(new URL('../src/core/owner-reconciliation-alerts.ts',import.meta.url),'utf8');
const ledger=readFileSync(new URL('../src/modules/finance/OwnerDeductionLedger.tsx',import.meta.url),'utf8');
const monthly=readFileSync(new URL('../src/modules/reports/MonthlyAccountingReport.tsx',import.meta.url),'utf8');
test('only approved owner charges enter draft-staleness computation',()=>{
 assert.match(helper,/d.status!=='APPROVED'/);
 assert.match(helper,/d.responsible_party!=='OWNER'/);
 assert.match(helper,/d.category==='TAX'/);
 assert.match(helper,/s.status==='DRAFT'/);
});
test('both ledger and monthly reporting warn against stale owner net',()=>{
 assert.match(ledger,/staleStatements=reconciliationAlerts/);
 assert.match(ledger,/Liquidación pendiente de conciliar/);
 assert.match(monthly,/staleCount/);
 assert.match(monthly,/Liquidación pendiente de conciliar/);
 assert.match(monthly,/cols:'id,lease_id,owner_id/);
});
