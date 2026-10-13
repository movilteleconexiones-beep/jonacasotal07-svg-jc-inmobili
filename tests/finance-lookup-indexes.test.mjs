import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const s=readFileSync(new URL('../supabase/migrations/20261013081500_finance_fk_lookup_indexes.sql',import.meta.url),'utf8');
test('financial reference indexes are safe and non-destructive',()=>{
 for(const pair of ['leases (organization_id,owner_id)','leases (organization_id,tenant_id)','owner_statements (organization_id,owner_id)','commission_review_requests (commission_id)'])assert.ok(s.includes(pair));
 assert.doesNotMatch(s,/\b(DROP|DELETE|UPDATE|ALTER|TRUNCATE)\b/i);
});
