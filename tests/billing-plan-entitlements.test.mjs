import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261011101500_basic_pro_explicit_entitlements.sql',import.meta.url),'utf8');
test('baseline is smaller than full professional permissions',()=>{
 const match=sql.match(/basic_keys text\[\] := array\[([\s\S]+?)\s*\];/);
 assert.ok(match);
 const keys=[...match[1].matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(x=>x[1]);
 assert.equal(keys.length,new Set(keys).size);
 assert.ok(keys.length>15&&keys.length<47);
 assert.ok(!keys.includes('roles.assign')&&!keys.includes('users.disable'));
});
test('no changes to tenant subscriptions, billing switches or existing members',()=>{
 assert.doesNotMatch(sql,/UPDATE\s+public\.(subscriptions|organization_billing_access|organization_members|billing_activation_settings)/i);
 assert.match(sql,/Unexpected plan catalog state/);
 assert.match(sql,/on conflict\(plan_id,feature_key\) do nothing/);
});
