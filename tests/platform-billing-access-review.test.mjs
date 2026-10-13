import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../security/tests/platform_billing_access_review.sql',import.meta.url),'utf8');
test('platform-only billing access audit covers protected financial tables and admin guards',()=>{
 for(const name of ['payment_events','payment_orders','subscriptions','organization_licenses','plans'])assert.ok(sql.includes("'"+name+"'"));
 assert.match(sql,/has_table_privilege\('authenticated'/);
 assert.match(sql,/billing_admin_action/);
 assert.match(sql,/billing_admin_set_mode/);
 assert.match(sql,/is_platform_admin\(\)/);
 assert.doesNotMatch(sql,/\b(INSERT INTO|UPDATE public\.|DELETE FROM|DROP TABLE|CREATE OR REPLACE|GRANT EXECUTE|REVOKE ALL)\b/i);
});
