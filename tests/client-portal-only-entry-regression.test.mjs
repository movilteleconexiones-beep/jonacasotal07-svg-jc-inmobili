import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {displayTenantRole,tenantAccessMode} from '../src/core/portal-access-mode.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const dashboard=read('src/modules/dashboard/PrivateDashboard.tsx');
const portal=read('src/modules/portal/PortalHub.tsx');
const users=read('src/modules/users/UsersRolesModule.tsx');
const tenantMenu=read('src/core/tenant-menu.ts');

test('organization owner is not synonymous with property owner',()=>{
 assert.match(displayTenantRole({key:'ORGANIZATION_OWNER',name:'Propietario'}),/Titular de la inmobiliaria/);
 assert.equal(displayTenantRole({key:'CLIENT',name:'Cliente'}),'Cliente');
 assert.deepEqual(tenantAccessMode([{key:'CLIENT'}]),{
   clientLinkedRole:true,hasOperationalRole:false,portalOnly:true,mixedElevated:false,
 });
 assert.deepEqual(tenantAccessMode([{key:'CLIENT'},{key:'ORGANIZATION_OWNER'}]),{
   clientLinkedRole:true,hasOperationalRole:true,portalOnly:false,mixedElevated:true,
 });
 assert.equal(tenantAccessMode([{key:'ADMIN'}]).clientLinkedRole,false);
 assert.equal(tenantAccessMode([{key:'CLIENT'},{key:null}]).portalOnly,false);
});

test('client-only account opens a separate portal without internal tenant navigation',()=>{
 assert.match(dashboard,/if \(mode\.portalOnly \|\| \(mode\.clientLinkedRole&&clientPortalMode\)\)/);
 assert.match(dashboard,/const \[clientPortalMode,setClientPortalMode\]=useState\(true\)/);
 assert.match(dashboard,/<PortalHub\/>/);
 assert.match(dashboard,/No se puede gestionar facturación desde una cuenta de Cliente/);
 assert.match(dashboard,/NO reduce los privilegios de tu sesión/);
 assert.match(dashboard,/únicamente el rol CLIENT/);
 assert.match(dashboard,/mode\.hasOperationalRole&&!previewAsTenant&&<button/);
 assert.match(dashboard,/activeMembership\.roles\.map\(displayTenantRole\)/);
 assert.match(dashboard,/if \(mode\.clientLinkedRole && clientPortalMode\) return/);
});

test('portal queries are always scoped to the current authenticated user and linked records',()=>{
 assert.match(portal,/\.eq\('user_id',user\.id\)/);
 assert.match(portal,/if\(!privateLinks\.length\)/);
 assert.match(portal,/\.in\('owner_id',ownerIds\)/);
 assert.match(portal,/\.in\('tenant_id',contactIds\)/);
 assert.match(portal,/\.in\('id',propertyIds\)/);
 assert.doesNotMatch(portal,/\.from\('(deals|leads|appointments|activities|documents)'\)/);
 assert.match(portal,/Ver catálogo de propiedades/);
 assert.match(portal,/Consignar mi propiedad/);
 assert.match(portal,/Sin fecha registrada/);
 assert.match(portal,/setPortalError\('No se pudo comprobar el acceso privado/);
 assert.doesNotMatch(portal,/\.from\('properties'\)\s*\.select\([\s\S]*?\.eq\('organization_id',organizationId\)\s*\.order\(/);
});

test('role assignment module clarifies mixed elevated accounts',()=>{
 assert.match(users,/Titular administrativo de la inmobiliaria · acceso elevado/);
 assert.match(users,/Conserva permisos elevados/);
 assert.match(users,/Portal como propietario/);
 assert.match(users,/displayTenantRole\(role\)/);
 assert.match(tenantMenu,/permissions:\s*\[P\.CLIENTS_VIEW\]/);
});
