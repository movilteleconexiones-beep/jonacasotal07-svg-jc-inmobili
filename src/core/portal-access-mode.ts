/** The real-estate property owner is linked through portal_access_links,
 *  NOT through the organization's master-administrator role. */
export function displayTenantRole(role:{key?:string|null;name:string}):string{
 if(role.key==='ORGANIZATION_OWNER')return 'Titular de la inmobiliaria (administración)';
 return role.name;
}

/** CLIENT is portal-only unless the account independently has a staff
 *  or organization-owner role. The server always decides data visibility. */
export function tenantAccessMode(roles:Array<{key?:string|null}>):{
 clientLinkedRole:boolean;
 hasOperationalRole:boolean;
 portalOnly:boolean;
 mixedElevated:boolean;
}{
 const clientLinkedRole=roles.some(r=>r.key==='CLIENT');
 const hasOperationalRole=roles.some(r=>r.key!=='CLIENT'&&Boolean(r.key));
 return {clientLinkedRole,hasOperationalRole,
  portalOnly:clientLinkedRole&&!hasOperationalRole,
  mixedElevated:clientLinkedRole&&hasOperationalRole};
}
