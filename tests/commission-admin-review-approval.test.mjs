import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const ui=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261013044500_paid_commission_admin_accept_no_disbursement.sql',import.meta.url),'utf8');
test('admin sees acceptance and annulment on pending reviews',()=>{
 assert.match(ui,/Aceptar y anular comisión \(sin desembolso\)/);
 assert.match(ui,/Aceptar y cerrar rectificación/);
 assert.match(ui,/accept_erroneous_paid_commission_review/);
 assert.match(ui,/isCommissionAdministrator && review.status==='PENDING'/);
});
test('server locks commission and review and preserves historical payment',()=>{
 assert.match(sql,/public\.commission_is_manager\(target_org\)/);
 assert.match(sql,/confirmation_no_disbursement IS DISTINCT FROM true/);
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/INSERT INTO public\.commission_accounting_corrections/);
 assert.match(sql,/self_authorized/);
 assert.doesNotMatch(sql,/UPDATE public\.commissions\s/i);
 assert.doesNotMatch(sql,/DELETE FROM public\.commissions\s/i);
});
