import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const users=read('src/modules/users/UsersRolesModule.tsx');
const viewer=read('src/modules/users/MemberPermissionOverview.tsx');
const editor=read('src/modules/users/RolePermissionEditor.tsx');
const sql=read('supabase/migrations/20261014123500_isolate_client_portal_role_grants.sql');

test('advisors and coordinators remain selectable and editable by their administrator',()=>{
 assert.match(users,/Ver y editar permisos/);
 assert.match(editor,/admin_update_role_permissions/);
 assert.match(editor,/can\(PERMISSIONS\.ROLES_EDIT\)/);
 assert.match(editor,/if\(!editable\)return true/);
 assert.match(editor,/Guardar permisos/);
});

test('client role is a private portal identity and can never receive tenant-wide access',()=>{
 assert.match(editor,/role\.key==='CLIENT'/);
 assert.match(editor,/!isPrivateClient/);
 assert.match(editor,/El perfil Cliente es exclusivamente para el portal privado/);
 assert.match(editor,/Portal como cliente/);
 assert.match(sql,/Client portal roles cannot receive tenant-wide operational permissions/);
 assert.match(sql,/BEFORE INSERT OR UPDATE OF role_id,permission_id/);
 assert.match(sql,/Cannot harden CLIENT role: existing grants must first be reviewed/);
 assert.doesNotMatch(users,/\.from\('role_permissions'\)\.insert\(/);
});

test('individual member overview combines assigned active roles and explicit overrides',()=>{
 assert.match(users,/Consultar permisos del usuario/);
 assert.match(users,/memberId=\{member.id\}/);
 assert.match(users,/allRoles=\{allRoles\}/);
 assert.match(users,/catalog=\{permissions\}/);
 assert.match(viewer,/\.from\('member_permissions'\)/);
 assert.match(viewer,/\.eq\('organization_member_id',memberId\)/);
 assert.match(viewer,/if\(item\.effect==='DENY'\)/);
 assert.match(viewer,/if\(item\.effect==='ALLOW'\)/);
 assert.match(viewer,/if\(!role\.active\)continue/);
 assert.match(viewer,/member\.status|status!=='ACTIVE'/);
 assert.match(viewer,/El plan contratado, el estado del usuario y los controles del servidor/);
});

test('client contact and owner portal links remain separate from general permissions',()=>{
 assert.match(users,/Portal como cliente/);
 assert.match(users,/Portal como propietario/);
 assert.match(users,/\.from\('portal_access_links'\)/);
 assert.match(viewer,/El acceso privado de Cliente se configura en «Portal como cliente»/);
});
