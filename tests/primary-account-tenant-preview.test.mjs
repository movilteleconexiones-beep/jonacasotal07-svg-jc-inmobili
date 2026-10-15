import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const dashboard=readFileSync(new URL('../src/modules/dashboard/PrivateDashboard.tsx',import.meta.url),'utf8');
const users=readFileSync(new URL('../src/modules/users/UsersRolesModule.tsx',import.meta.url),'utf8');
const portal=readFileSync(new URL('../src/modules/portal/PortalHub.tsx',import.meta.url),'utf8');

test('only actual platform administrators can see the three tenant preview options',()=>{
 assert.match(dashboard,/const previewAsTenant=isPlatformAdmin&&Boolean\(activeMembership\)/);
 assert.match(dashboard,/const \[tenantPreviewRole,setTenantPreviewRole\]=useState<'OWNER'\|'ADMIN'>\('OWNER'\)/);
 assert.match(dashboard,/Elegir vista de prueba de la inmobiliaria/);
 assert.match(dashboard,/Titular de la inmobiliaria/);
 assert.match(dashboard,/Administrador de inmobiliaria/);
 assert.match(dashboard,/Cliente · Mi portal privado/);
 assert.match(dashboard,/Salir de prueba · Superadministrador/);
 assert.match(dashboard,/if\(!previewAsTenant\)return/);
});

test('switching views does not change membership, server role grants or authentication',()=>{
 assert.match(dashboard,/setTenantPreviewRole\(next\)/);
 assert.match(dashboard,/setClientPortalMode\(true\)/);
 assert.match(dashboard,/setClientPortalMode\(false\)/);
 assert.match(dashboard,/setView\('DASHBOARD'\)/);
 assert.match(dashboard,/Los permisos reales de superadministrador no cambian/);
 assert.match(dashboard,/La vista privada oculta/);
 assert.doesNotMatch(dashboard,/\.from\('member_roles'\)\.(insert|delete|update)\(/);
 assert.doesNotMatch(dashboard,/\.from\('platform_admins'\)\.(insert|delete|update)\(/);
 assert.doesNotMatch(dashboard,/\.rpc\('admin_update_role_permissions'/);
});

test('private client portal is still scoped to the authenticated linked account',()=>{
 assert.match(dashboard,/if \(mode\.portalOnly \|\| \(mode\.clientLinkedRole&&clientPortalMode\)\)/);
 assert.match(portal,/\.from\('portal_access_links'\)/);
 assert.match(portal,/\.eq\('organization_id',organizationId\)\.eq\('user_id',user\.id\)/);
 assert.match(portal,/setOwners\(ownerIds\);setContacts\(contactIds\)/);
 assert.match(portal,/ownerIds\.length\?await checked/);
 assert.match(portal,/contactIds\.length\?await checked/);
});

test('Users gives current owner a self-linking path and an accurate status',()=>{
 assert.match(users,/Vinculación del usuario actual/);
 assert.match(users,/members\.some\(member=>member\.user_id===user\?\.id\)/);
 assert.match(users,/portalLinks\.some\(link=>link\.user_id===user\?\.id&&link\.contact_id\)/);
 assert.match(users,/Portal como cliente/);
 assert.match(users,/No es necesario crear otro usuario/);
});
