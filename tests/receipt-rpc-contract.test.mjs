import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

// Documentary checklist only: this test DOES NOT invoke production RPCs.
const checklist=readFileSync(new URL('./fixtures/rent-receipt-rpc-contract.sql',import.meta.url),'utf8');
test('payment RPC checklist covers release-critical cases',()=>{
  for(const term of ['has_org_permission','FOR UPDATE','idempotency_key','new_paid>entry.expected_amount','cross-tenant deny','overpay deny'])
    assert.ok(checklist.includes(term),'Missing '+term);
});
test('requires real role-isolation and receipt evidence follow-up',()=>{
  assert.match(checklist,/authenticated AGENT deny, MANAGER allow/);
  assert.match(checklist,/failed evidence attachment must roll back payment/);
});
