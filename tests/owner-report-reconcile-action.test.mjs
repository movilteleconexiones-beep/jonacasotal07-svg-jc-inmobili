import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const source=readFileSync(new URL('../src/modules/reports/MonthlyAccountingReport.tsx',import.meta.url),'utf8');
test('report offers authorized, explicitly confirmed, audited owner reconciliation',()=>{
 assert.match(source,/reconcile_owner_draft_statement_audited/);
 assert.match(source,/OWNER_STATEMENTS_CREATE/);
 assert.match(source,/RENT_PAYMENTS_VIEW/);
 assert.match(source,/window.confirm/);
 assert.match(source,/Actualizar conciliación ahora/);
 assert.match(source,/\.eq\('id',statementId\)\.maybeSingle\(\)/);
 assert.match(source,/setRevision\(v=>v\+1\)/);
});
