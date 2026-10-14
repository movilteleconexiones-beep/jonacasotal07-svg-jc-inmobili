import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const users=readFileSync(new URL('../src/modules/users/UsersRolesModule.tsx',import.meta.url),'utf8');
const editor=readFileSync(new URL('../src/modules/users/RolePermissionEditor.tsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261014093000_audited_role_permission_editor.sql',import.meta.url),'utf8');

test('role cards open an accessible permission editor with current grants loaded',()=>{
 assert.match(users,/Ver y editar permisos/);
 assert.match(users,/selectedRoleId/);
 assert.match(users,/aria-expanded=\{selectedRoleId===role.id\}/);
 assert.match(users,/<RolePermissionEditor key=\{selectedRoleId\}/);
 assert.match(users,/role_permissions\(permissions\(key\)\)/);
 assert.match(editor,/function currentPermissions\(role:EditableRole\)/);
 assert.match(editor,/role\.role_permissions\?\?/);
 assert.match(editor,/checked=\{chosen\.has\(p\.key\)\}/);
 assert.match(editor,/MODULE_LABELS/);
 assert.match(editor,/Guardar permisos/);
});

test('administration is verified both in UI and PostgreSQL, never only from a checkbox',()=>{
 assert.match(users,/activeMembership\?\.roles\.some\(role=>role.key==='ADMIN'\)/);
 assert.match(editor,/can\(PERMISSIONS\.ROLES_EDIT\)/);
 assert.match(editor,/admin_update_role_permissions/);
 assert.match(editor,/expected_permission_keys:baseline/);
 assert.match(editor,/desired_permission_keys:selected/);
 assert.match(migration,/SELECT \* INTO role_record FROM public\.roles/);
 assert.match(migration,/r\.organization_id=target_org AND r\.active/);
 assert.match(migration,/ar\.organization_id=target_org AND ar\.key='ADMIN'/);
 assert.match(migration,/Permissions changed since the page was opened/);
 assert.match(migration,/role\.permissions_changed/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.admin_update_role_permissions/);
});

test('base identities are protected but their operational permissions can be changed',()=>{
 assert.match(users,/Base protegida/);
 assert.match(editor,/ADMIN_FIXED/);
 assert.match(editor,/RESTRICTED/);
 assert.match(editor,/SENSITIVE/);
 assert.match(editor,/window\.confirm/);
 assert.match(migration,/Core administrator permissions cannot be removed/);
 assert.match(migration,/Administrative or destructive permissions cannot be granted/);
 assert.match(migration,/You cannot delegate a permission you do not currently have/);
 assert.match(migration,/REVOKE INSERT,UPDATE,DELETE ON public\.role_permissions/);
 assert.doesNotMatch(users,/\.from\('role_permissions'\)\.insert\(/);
 assert.doesNotMatch(users,/\.from\('role_permissions'\)\.delete\(/);
});

test('role changes are audited and do not directly alter the payments or underlying users',()=>{
 assert.match(migration,/INSERT INTO public\.audit_log/);
 assert.match(migration,/metadata/);
 assert.match(migration,/added_keys/);
 assert.match(migration,/removed_keys/);
 assert.doesNotMatch(migration,/DELETE FROM public\.member_roles/);
 assert.doesNotMatch(migration,/UPDATE public\.rent_payments/);
 assert.doesNotMatch(migration,/DELETE FROM public\.organization_members/);
});
