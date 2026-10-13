import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261013070000_correct_owner_draft_commission_percentage.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/modules/reports/MonthlyAccountingReport.tsx',import.meta.url),'utf8');
test('draft commission correction computes percentage from collected rent with audit',()=>{
 assert.match(sql,/round\(collected\*new_percentage\/100,2\)/);
 assert.match(sql,/old_row.status<>'DRAFT'/);
 assert.match(sql,/commission_is_manager\(target_org\)/);
 assert.match(sql,/owner_statement.commission_percentage_corrected/);
 assert.match(sql,/category='COMMISSION' AND status='APPROVED'/);
 assert.match(ui,/correct_owner_draft_commission_percentage/);
 assert.match(ui,/Corregir comisión de administración \(%\) del borrador/);
});
