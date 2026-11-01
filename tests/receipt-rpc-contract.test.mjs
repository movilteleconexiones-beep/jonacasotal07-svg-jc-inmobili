import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./fixtures/rent-receipt-rpc-contract.sql',import.meta.url),'utf8');
test('fixture retains authorization, idempotency, lock and ceiling',()=>{
 for(const term of ['has_org_permission','FOR UPDATE','idempotency_key','new_paid>entry.expected_amount'])
   assert.ok(sql.includes(term), 'Missing '+term);
});
test('evidence wrapper delegates to authoritative receipt RPC',()=>{
 assert.match(sql,/record_tenant_rent_receipt\(/);
});
