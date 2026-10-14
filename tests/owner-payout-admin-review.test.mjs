import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261014050000_owner_payout_admin_review.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/modules/finance/RentOwnerBalances.tsx',import.meta.url),'utf8');
test('admin-only decisions cannot alter payout ledger',()=>{
 assert.match(sql,/commission_is_manager\(p_organization_id\)/);
 assert.match(sql,/has_org_permission\(p_organization_id,'owner_statements.create'\)/);
 assert.match(sql,/v_review.status <> 'PENDING'/);
 assert.doesNotMatch(sql,/UPDATE public.owner_statement_payouts|DELETE FROM public.owner_statement_payouts/i);
});
test('admin decision UI requires justification and explicit approval',()=>{
 assert.match(ui,/admin_decide_owner_payout_review/);
 assert.match(ui,/Aprobar revisión/);
 assert.match(ui,/Rechazar/);
 assert.match(ui,/adminNote.trim\(\).length<15/);
});