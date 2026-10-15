import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../supabase/migrations/20261015081500_basic_pro_functional_parity.sql',import.meta.url),'utf8');

test('BASIC receives full PRO commercial feature ceiling, including role and finance modules',()=>{
 assert.match(migration,/INSERT INTO public.plan_features\(plan_id,feature_key,enabled\)/);
 assert.match(migration,/SELECT basic_id,pf.feature_key,true FROM public.plan_features pf/);
 assert.match(migration,/WHERE pf.plan_id=pro_id AND pf.enabled/);
 assert.match(migration,/inserted<>26/);
 assert.match(migration,/pro_count<>47/);
 assert.match(migration,/basic_count NOT IN \(21,47\)/);
});
test('historical subscriptions, individuals, prices, quota limits and LIFETIME remain unchanged',()=>{
 assert.doesNotMatch(migration,/UPDATE\s+public\.(subscriptions|plans|organization_members|member_roles|member_permissions|organization_billing_access|billing_activation_settings|payment_orders|organization_licenses)/i);
 assert.doesNotMatch(migration,/DELETE\s+FROM\s+public\./i);
 assert.match(migration,/price=129900/);
 assert.match(migration,/price=299900/);
 assert.doesNotMatch(migration,/\bUPDATE\s+public\.plan_features\b/i);
});
test('strict catalog checks and repeat-safe installation',()=>{
 assert.match(migration,/Permission catalog changed; manual review required/);
 assert.match(migration,/Basic and Professional entitlements differ after previous update/);
 assert.match(migration,/ON CONFLICT\(plan_id,feature_key\) DO NOTHING/);
 assert.match(migration,/RETURN; -- idempotent/);
});
