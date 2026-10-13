import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const ui=readFileSync(new URL('../src/modules/finance/OwnerDeductionLedger.tsx',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261013043000_owner_deduction_admin_only_void.sql',import.meta.url),'utf8');
test('non-admin profiles cannot void an owner deduction',()=>{
 assert.match(ui,/const canVoid=writable&&/);
 assert.match(ui,/status==='VOIDED'&&!canVoid/);
 assert.match(ui,/editable&&canVoid&&line.status!=='VOIDED'/);
 assert.match(sql,/NOT public\.commission_is_manager\(OLD.organization_id\)/);
 assert.match(sql,/BEFORE UPDATE ON public.owner_statement_deductions/);
});
