import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261013190000_owner_deduction_admin_approval.sql',import.meta.url),'utf8');
test('deduction approval and cancellation both require org manager',()=>{
 assert.match(sql,/NEW.status='APPROVED' AND OLD.status='DRAFT'/);
 assert.match(sql,/NEW.status='VOIDED' AND OLD.status IS DISTINCT FROM 'VOIDED'/);
 assert.match(sql,/has_org_permission\(OLD.organization_id,'owner_statements.create'\)/);
 assert.match(sql,/commission_is_manager\(OLD.organization_id\)/);
 assert.doesNotMatch(sql,/\b(UPDATE public\.|DELETE FROM public\.|TRUNCATE)\b/i);
});