import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261014040000_owner_payout_review_requests.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/modules/finance/RentOwnerBalances.tsx',import.meta.url),'utf8');
test('reviews do not mutate financial history or bypass tenant permissions',()=>{
 assert.match(sql,/has_org_permission\(p_organization_id,'owner_statements.view'\)/);
 assert.match(sql,/WHERE status='PENDING'/);
 assert.doesNotMatch(sql,/UPDATE public.owner_statement_payouts|DELETE FROM public.owner_statement_payouts/i);
 assert.match(sql,/REVOKE ALL ON public.owner_payout_review_requests/);
});
test('payout UI displays audit recorder and creates review request',()=>{
 assert.match(ui,/recorded_by,recorded_at/);
 assert.match(ui,/Registrado por:/);
 assert.match(ui,/request_owner_payout_review/);
 assert.match(ui,/Solicitar corrección/);
});