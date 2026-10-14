import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261014030000_owner_payout_ledger.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/modules/finance/RentOwnerBalances.tsx',import.meta.url),'utf8');
test('payout ledger is admin-only, tenant-bound and double-payment protected',()=>{
 assert.match(sql,/commission_is_manager\(p_organization_id\)/);
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/v_paid\+p_amount>v_statement.net_amount/);
 assert.match(sql,/UNIQUE\(organization_id,statement_id,payment_reference\)/);
 assert.match(sql,/status='PAID'/);
 assert.match(sql,/recorded_by uuid NOT NULL/);
 assert.match(sql,/evidence_reference text NOT NULL/);
 assert.match(sql,/REVOKE ALL ON public.owner_statement_payouts/);
});
test('UI records completed transfer only with explicit confirmation',()=>{
 assert.match(ui,/admin_record_owner_payout/);
 assert.match(ui,/Confirma que este dinero YA fue entregado/);
 assert.match(ui,/mayIssue&&selected.status==='GENERATED'/);
 assert.match(ui,/Consultar pagos/);
});