import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('security/ops/g14_member_role_tenant_boundary.sql');
const fixture=read('security/tests/g14_member_role_tenant_clone_rollback.sql');

test('G14 enforces tenant ownership on every new or changed role grant',()=>{
 assert.match(sql,/jco_private\.guard_member_role_same_tenant\(\)/);
 assert.match(sql,/LANGUAGE plpgsql SECURITY DEFINER SET search_path=''/);
 assert.match(sql,/TG_OP NOT IN \('INSERT','UPDATE'\)/);
 assert.match(sql,/NEW\.organization_member_id/);
 assert.match(sql,/NEW\.role_id/);
 assert.match(sql,/role_org IS DISTINCT FROM member_org/);
 assert.match(sql,/RAISE EXCEPTION 'El rol debe pertenecer a la misma inmobiliaria'/);
 assert.match(sql,/BEFORE INSERT OR UPDATE ON public\.member_roles/);
 assert.match(sql,/REVOKE ALL ON FUNCTION jco_private\.guard_member_role_same_tenant\(\)/);
 assert.match(sql,/jco_billing_auth_lock/);
});
test('G14 migration is atomic, scoped and refuses preexisting orphan tenant assignments',()=>{
 assert.match(sql,/^BEGIN;$/m);
 assert.match(sql,/^COMMIT;\s*$/m);
 assert.match(sql,/SET LOCAL lock_timeout='3s'/);
 assert.match(sql,/SET LOCAL statement_timeout='30s'/);
 assert.match(sql,/current_user <> 'postgres'/);
 assert.match(sql,/Historical cross-tenant role assignments require review/);
 assert.match(sql,/r\.organization_id IS DISTINCT FROM m\.organization_id/);
 assert.equal((sql.match(/^CREATE TRIGGER /gm)||[]).length,1);
 assert.doesNotMatch(sql,/\b(?:UPDATE public\.|DELETE FROM public\.|INSERT INTO public\.|ALTER TABLE|CREATE POLICY|GRANT EXECUTE|TRUNCATE)\b/i);
});
test('G14 clone QA checks allow same-tenant changes but reject cross-tenant insert AND update',()=>{
 assert.match(fixture,/SET LOCAL ROLE authenticated/);
 assert.match(fixture,/has_org_permission\(v_qa_org,'roles.assign'\)/);
 assert.match(fixture,/INSERT INTO public\.member_roles/);
 assert.match(fixture,/DELETE FROM public\.member_roles/);
 assert.match(fixture,/UPDATE public\.member_roles SET role_id=v_foreign_role/);
 assert.match(fixture,/WHEN check_violation THEN/g);
 assert.match(fixture,/v_pass<>5/);
 assert.match(fixture,/v_pass:=v_pass\+1/);
});
