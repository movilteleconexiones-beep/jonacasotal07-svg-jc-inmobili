import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261013073000_prevent_duplicate_active_commissions.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
test('duplicate protection uses organization, deal, type and beneficiary; preserves different roles',()=>{
 for(const field of ['organization_id','deal_id','commission_type','beneficiary_user_id']) assert.match(sql,new RegExp('c\\.'+field));
 assert.match(sql,/c.status<>'CANCELLED'/);
 assert.match(sql,/commission_accounting_corrections/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(ui,/Ya existe una comisión activa/);
});
