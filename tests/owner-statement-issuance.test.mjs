import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261014020000_admin_issue_owner_statement.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/modules/finance/RentOwnerBalances.tsx',import.meta.url),'utf8');
test('issuance requires active administrator and verified financial totals',()=>{
 assert.match(sql,/commission_is_manager\(p_organization_id\)/);
 assert.match(sql,/has_org_permission\(p_organization_id,'owner_statements.create'\)/);
 assert.match(sql,/v_pending>0/);
 assert.match(sql,/v_deductions <> v_statement.other_deductions/);
 assert.match(sql,/status='GENERATED'/);
 assert.doesNotMatch(sql,/status='PAID'/);
 assert.match(sql,/REVOKE ALL ON FUNCTION/);
});
test('comprobante remains distinct from explicit admin issuance',()=>{
 assert.match(ui,/Generar comprobante/);
 assert.match(ui,/Confirmar emisión/);
 assert.match(ui,/admin_issue_owner_statement/);
 assert.match(ui,/mayIssue&&statement.status==='DRAFT'/);
});