import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const report=readFileSync(new URL('../src/modules/reports/MonthlyAccountingReport.tsx',import.meta.url),'utf8');
const ledger=readFileSync(new URL('../src/modules/finance/OwnerDeductionLedger.tsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261013063000_restore_voided_owner_deduction.sql',import.meta.url),'utf8');
test('other owner charges are drawn from approved owner ledger, excluding cancelled and taxes/commissions',()=>{
 assert.match(report,/owner_statement_deductions/);
 assert.match(report,/item.status==='APPROVED'&&item.responsible_party==='OWNER'/);
 assert.match(report,/item.category!=='TAX'&&item.category!=='COMMISSION'/);
 assert.match(report,/financialTotal\(find\('Deducciones'\),'amount'\)/);
});
test('only administrators can restore voided owner deduction into a new draft with audit',()=>{
 assert.match(ledger,/Recuperar como borrador/);
 assert.match(ledger,/restore_voided_owner_deduction/);
 assert.match(migration,/commission_is_manager\(target_org\)/);
 assert.match(migration,/old_entry.status<>'VOIDED'/);
 assert.match(migration,/status='DRAFT' FOR UPDATE/);
 assert.match(migration,/owner_deductions.restored_as_draft/);
 assert.doesNotMatch(migration,/DELETE FROM public.owner_statement_deductions/);
});

const exportSource=readFileSync(new URL('../src/core/accounting-export.ts',import.meta.url),'utf8');
test('deduction Excel matches approved owner charges rather than stale liquidation snapshot',()=>{assert.match(exportSource,/OWNER_OTHER: \{ label:'Otras deducciones de propietarios', source:'Deducciones' \}/);assert.match(exportSource,/key==='OWNER_OTHER'\?'amount'/);});
