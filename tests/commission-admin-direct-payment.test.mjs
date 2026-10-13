import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261013054000_admin_direct_commission_payment_status.sql',import.meta.url),'utf8');
test('admin can directly record payment with independent confirmation',()=>{
 assert.match(source,/status==='PAID'\s*\? await supabase\.rpc\('admin_record_commission_paid'/);
 assert.match(source,/payment_reference:reason\.trim\(\)/);
 assert.match(source,/status==='PAID'&&!window\.confirm/);
});
test('admin direct payment requires actual evidence and an audit entry',()=>{
 assert.match(migration,/commission_is_manager\(target_org\)/);
 assert.match(migration,/c\.status NOT IN\('PENDING','APPROVED','PAYABLE'\)/);
 assert.match(migration,/payment_reference/);
 assert.match(migration,/commissions\.admin_marked_paid/);
 assert.match(migration,/FOR UPDATE/);
});
