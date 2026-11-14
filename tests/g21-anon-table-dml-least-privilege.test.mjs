import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const src=readFileSync(new URL('../security/candidates/g21_anon_table_dml_least_privilege.sql',import.meta.url),'utf8');

test('G21 preserves operational RLS, locks and atomic rollback on errors',()=>{
 assert.match(src,/^BEGIN;/m);
 assert.match(src,/^COMMIT;/m);
 assert.match(src,/lock_timeout='3s'/);
 assert.match(src,/current_user <> 'postgres'/);
 assert.match(src,/c\.relrowsecurity/);
 assert.match(src,/p\.polcmd IN \('\*','a','w','d'\)/);
 assert.match(src,/legitimate anonymous write policy/);
 assert.match(src,/anonymous write grants remain/);
 assert.doesNotMatch(src,/^\s*(?:UPDATE\s+public\.|DELETE\s+FROM\s+public\.|INSERT\s+INTO\s+public\.|TRUNCATE\s+public\.|DROP\s+TABLE|ALTER\s+TABLE|DISABLE\s+ROW\s+LEVEL\s+SECURITY)/im);
});
test('G21 only revokes anon direct writes on 31 pinned tables, not other roles',()=>{
 const sql=[...src.matchAll(/^REVOKE INSERT, UPDATE, DELETE ON TABLE public\.([a-z_]+) FROM anon;$/gm)];
 assert.equal(sql.length,31);
 assert.equal(new Set(sql.map(m=>m[1])).size,31);
 for(const expected of ['organization_members','member_roles','platform_admins','payment_orders','organization_invitations','profiles','commissions','property_ownerships','roles']){
   if(expected==='payment_orders')assert.equal(sql.some(m=>m[1]===expected),false,'payment order service ACL unchanged');
   else assert.ok(sql.some(m=>m[1]===expected),expected);
 }
 assert.doesNotMatch(src,/REVOKE\s+(?:ALL|EXECUTE)\b/i);
 assert.doesNotMatch(src,/FROM (?:authenticated|service_role)/i);
 assert.match(src,/has_function_privilege\('anon','public\.tenant_public_catalog\(text\)'/);
 assert.match(src,/has_table_privilege\('authenticated','public\.organization_members','INSERT'\)/);
 assert.match(src,/has_table_privilege\('service_role','public\.organization_members','INSERT'\)/);
});
