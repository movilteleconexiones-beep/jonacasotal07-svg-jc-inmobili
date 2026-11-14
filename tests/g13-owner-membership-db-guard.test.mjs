import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('security/ops/g13_protect_last_owner_system_roles.sql');
const qa=read('security/tests/g13_last_owner_membership_clone_rollback.sql');

test('G13 guards identity, SuperAdmin, last owner and system roles in PostgreSQL',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION jco_private\.guard_protected_membership_mutations\(\)/);
 assert.match(sql,/SECURITY DEFINER SET search_path=''/);
 assert.match(sql,/NEW\.user_id IS DISTINCT FROM OLD\.user_id/);
 assert.match(sql,/NEW\.organization_id IS DISTINCT FROM OLD\.organization_id/);
 assert.match(sql,/platform_admins pa[\s\S]*pa\.active/);
 assert.match(sql,/r\.key='ORGANIZATION_OWNER' AND r\.active/g);
 assert.match(sql,/m\.user_id IS DISTINCT FROM v_user/);
 assert.match(sql,/OLD\.is_system_role/);
 for(const trigger of [
  'z_jco_last_owner_membership_guard',
  'z_jco_last_owner_roles_guard',
  'z_jco_system_role_delete_guard'
 ]) assert.match(sql,new RegExp('CREATE TRIGGER '+trigger));
 assert.match(sql,/jco_billing_auth_lock/);
});

test('G13 is atomic and never grants tenant privileges or changes financial data',()=>{
 assert.match(sql,/^BEGIN;$/m);
 assert.match(sql,/^COMMIT;\s*$/m);
 assert.match(sql,/SET LOCAL lock_timeout='3s'/);
 assert.match(sql,/SET LOCAL statement_timeout='30s'/);
 assert.match(sql,/current_user<>'postgres'/);
 assert.match(sql,/REVOKE ALL ON FUNCTION jco_private\.guard_protected_membership_mutations\(\)/);
 assert.equal((sql.match(/^CREATE TRIGGER /gm)||[]).length,3);
 assert.doesNotMatch(sql,/\b(?:GRANT|INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE|CREATE POLICY|ALTER TABLE)\b/i);
});

test('G13 clone rollback protects 7 negative mutations and preserves ordinary edits',()=>{
 const cases=[
  'last active owner suspension allowed',
  'membership identity reassignment allowed',
  'last owner role deletion allowed',
  'last owner role demotion allowed',
  'SuperAdmin member suspension allowed',
  'SuperAdmin role deletion allowed',
  'system role deletion allowed'
 ];
 for(const fragment of cases)assert.ok(qa.includes(fragment),fragment);
 assert.match(qa,/WHEN insufficient_privilege THEN v_pass:=v_pass\+1/g);
 assert.match(qa,/v_pass<>8/);
 assert.match(qa,/Harmless member update must still work/);
 assert.match(qa,/status=status/);
 assert.doesNotMatch(qa,/cuitgyqrjibgwuniapmk/);
});
