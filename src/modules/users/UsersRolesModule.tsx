import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';
import { RolePermissionEditor } from './RolePermissionEditor';
import { MemberPermissionOverview } from './MemberPermissionOverview';
import { displayTenantRole } from '../../core/portal-access-mode';
import {InvitationHistory,type InvitationRow} from './InvitationHistory';

const isTenantRole = (role: { key: string | null; name: string }) =>
  role.key !== 'ORGANIZATION_OWNER' && role.key !== 'SUPER_ADMIN' && role.key !== 'PLATFORM_OWNER' && !/super.?admin|platform.?admin/i.test(role.name);

interface RoleRow {
  id: string;
  name: string;
  key: string | null;
  description: string | null;
  is_system_role: boolean;
  active: boolean;
  role_permissions?: Array<{ permissions: { key: string } | null }>;
}

interface PermissionRow {
  id: string;
  key: string;
  description: string | null;
}

interface MemberRow {
  id: string;
  user_id: string;
  status: string;
  joined_at: string | null;
  member_roles: Array<{
    role_id: string;
    roles: { id: string; name: string; key: string | null } | null;
  }>;
}

interface ContactOption {
  id: string;
  first_name: string;
  last_name: string | null;
}

interface OwnerOption {
  id: string;
  first_name: string;
  last_name: string | null;
}

interface PortalLinkRow {
  id: string;
  user_id: string;
  contact_id: string | null;
  owner_id: string | null;
}


export function UsersRolesModule() {
  const { user, activeMembership, can } = useAuth();
  const organizationId = activeMembership?.organization.id;

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [allRoles,setAllRoles]=useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [invitationLoadError,setInvitationLoadError]=useState('');
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [portalLinks, setPortalLinks] = useState<PortalLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [profilesById, setProfilesById] = useState<Record<string, { full_name: string | null; phone: string | null; avatar_url: string | null }>>({});
  const [showInvite, setShowInvite] = useState(false);
  const [showRoleCreator, setShowRoleCreator] = useState(false);
  const [workingOn, setWorkingOn] = useState<string | null>(null);
  const [selectedRoleId,setSelectedRoleId]=useState<string|null>(null);
  const [expandedMemberId,setExpandedMemberId]=useState<string|null>(null);
  const canEditPermissions=(activeMembership?.roles.some(role=>role.key==='ADMIN')??false)
    &&can(PERMISSIONS.ROLES_EDIT);

  async function load() {
    if (!organizationId) return;
    setLoading(true);
    setMessage('');
    setInvitationLoadError('');
    setInvitations([]);

    const [membersResult, rolesResult, permissionsResult, invitationsResult, contactsResult, ownersResult, portalLinksResult] = await Promise.all([
      supabase
        .from('organization_members')
        .select('id,user_id,status,joined_at,member_roles(role_id,roles(id,name,key))')
        .eq('organization_id', organizationId)
        .order('created_at'),
      supabase
        .from('roles')
        .select('id,name,key,description,is_system_role,active,role_permissions(permissions(key))')
        .eq('organization_id', organizationId)
        .order('is_system_role', { ascending: false })
        .order('name'),
      supabase
        .from('permissions')
        .select('id,key,description')
        .order('key'),
      supabase
        .from('organization_invitations')
        .select('id,email,full_name,status,expires_at,created_at,accepted_at,invitation_roles(role_id,roles(id,name,key))',{count:'exact'})
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(501),
      supabase
        .from('contacts')
        .select('id,first_name,last_name')
        .eq('organization_id', organizationId)
        .order('first_name'),
      supabase
        .from('property_owners')
        .select('id,first_name,last_name')
        .eq('organization_id', organizationId)
        .order('first_name'),
      supabase
        .from('portal_access_links')
        .select('id,user_id,contact_id,owner_id')
        .eq('organization_id', organizationId),
    ]);

    if (membersResult.error) setMessage(membersResult.error.message);
    if (rolesResult.error) setMessage((current) => current || rolesResult.error!.message);
    if (permissionsResult.error) setMessage((current) => current || permissionsResult.error!.message);
    if (invitationsResult.error || invitationsResult.count==null ||
       invitationsResult.count>500 || (invitationsResult.data??[]).length!==invitationsResult.count){
      setInvitationLoadError('No fue posible consultar el historial completo de invitaciones. Actualiza o contacta al administrador.');
    }

    const memberRows = (membersResult.data ?? []) as unknown as MemberRow[];
    setMembers(memberRows);

    const userIds = memberRows.map((member) => member.user_id);
    if (userIds.length > 0) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id,full_name,phone,avatar_url')
        .in('id', userIds);

      const nextProfiles: Record<string, { full_name: string | null; phone: string | null; avatar_url: string | null }> = {};
      for (const profile of profileRows ?? []) {
        nextProfiles[profile.id] = {
          full_name: profile.full_name,
          phone: profile.phone,
          avatar_url: profile.avatar_url,
        };
      }
      setProfilesById(nextProfiles);
    } else {
      setProfilesById({});
    }

    setRoles(((rolesResult.data ?? []) as unknown as RoleRow[]).filter(isTenantRole));
    setAllRoles((rolesResult.data ?? []) as unknown as RoleRow[]);
    setPermissions((permissionsResult.data ?? []) as PermissionRow[]);
    if (!invitationsResult.error && invitationsResult.count!=null &&
      invitationsResult.count<=500 && (invitationsResult.data??[]).length===invitationsResult.count){
      setInvitations((invitationsResult.data ?? []) as unknown as InvitationRow[]);
    }
    setContacts((contactsResult.data ?? []) as ContactOption[]);
    setOwners((ownersResult.data ?? []) as OwnerOption[]);
    setPortalLinks((portalLinksResult.data ?? []) as PortalLinkRow[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !user || !can(PERMISSIONS.USERS_CREATE)) return;

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const fullName = String(form.get('full_name') ?? '').trim();
    const selectedRoleIds = roles
      .filter((role) => role.active && form.get('role_' + role.id) === 'on')
      .map((role) => role.id);

    if (!email.includes('@')) {
      setMessage('Ingresa un correo electrónico válido.');
      return;
    }

    if (selectedRoleIds.length === 0) {
      setMessage('Selecciona al menos un rol para la invitación.');
      return;
    }

    const { data: existing } = await supabase
      .from('organization_invitations')
      .select('id,status')
      .eq('organization_id', organizationId)
      .eq('email', email)
      .maybeSingle();

    let invitationId = existing?.id as string | undefined;

    if (invitationId) {
      const { error } = await supabase
        .from('organization_invitations')
        .update({
          full_name: fullName || null,
          status: 'PENDING',
          invited_by: user.id,
          expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          accepted_by: null,
          accepted_at: null,
        })
        .eq('id', invitationId);

      if (error) {
        setMessage(error.message);
        return;
      }

      await supabase.from('invitation_roles').delete().eq('invitation_id', invitationId);
    } else {
      const { data, error } = await supabase
        .from('organization_invitations')
        .insert({
          organization_id: organizationId,
          email,
          full_name: fullName || null,
          invited_by: user.id,
        })
        .select('id')
        .single();

      if (error) {
        setMessage(error.message);
        return;
      }

      invitationId = data.id;
    }

    const { error: rolesError } = await supabase
      .from('invitation_roles')
      .insert(selectedRoleIds.map((roleId) => ({
        invitation_id: invitationId!,
        role_id: roleId,
      })));

    if (rolesError) {
      setMessage(rolesError.message);
      return;
    }

    setMessage(
      'Invitación preparada. La persona debe crear o iniciar sesión con ese mismo correo; el sistema asignará automáticamente sus roles.',
    );
    setShowInvite(false);
    event.currentTarget.reset();
    await load();
  }

  async function toggleMemberRole(member: MemberRow, roleId: string, enabled: boolean) {
    if (!can(PERMISSIONS.ROLES_ASSIGN) || !roles.some((role) => role.id === roleId && role.active && isTenantRole(role))) return;

    if (enabled) {
      const { error } = await supabase
        .from('member_roles')
        .insert({ organization_member_id: member.id, role_id: roleId });
      if (error && !error.message.toLowerCase().includes('duplicate')) {
        setMessage(error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from('member_roles')
        .delete()
        .eq('organization_member_id', member.id)
        .eq('role_id', roleId);
      if (error) {
        setMessage(error.message);
        return;
      }
    }

    await load();
  }

  async function retireMember(member: MemberRow, displayName: string) {
    if (!organizationId || !can(PERMISSIONS.USERS_EDIT) || workingOn) return;
    if (member.status !== 'ACTIVE') return;
    if (member.user_id === user?.id || isLastActiveOwner(member)) {
      setMessage('No se puede retirar tu propio acceso ni el del último propietario activo de la inmobiliaria.');
      return;
    }
    const typed = window.prompt('RETIRAR USUARIO: se desactivarán sus permisos en esta inmobiliaria, pero conservará su cuenta y el historial. Escribe RETIRAR para confirmar a ' + displayName + '.');
    if (typed !== 'RETIRAR') return;
    setWorkingOn(member.id);
    try {
      const { error } = await supabase.from('organization_members')
        .update({ status: 'INACTIVE' })
        .eq('id', member.id).eq('organization_id', organizationId).eq('status', 'ACTIVE');
      if (error) throw error;
      await load();
      setMessage('Usuario retirado de esta inmobiliaria. Su cuenta y los documentos históricos se conservan. Puedes reactivar su acceso.');
    } catch {
      setMessage('No se pudo retirar al usuario. Verifica los permisos y actualiza la lista.');
    } finally { setWorkingOn(null); }
  }

  async function setCustomRoleActive(role: RoleRow, active: boolean) {
    if (!organizationId || !can(PERMISSIONS.ROLES_EDIT) || role.is_system_role ||
        !isTenantRole(role) || workingOn || role.active === active) return;
    if (!active) {
      const affected = members.filter(member =>
        member.status === 'ACTIVE' && member.member_roles.some(link => link.role_id === role.id)).length;
      const approved = window.prompt('DESACTIVAR ROL PERSONALIZADO: ' + role.name +
        '. ' + affected + ' miembros activos tienen este rol; perderán sus permisos de este rol. Escribe DESACTIVAR para confirmar.');
      if (approved !== 'DESACTIVAR') return;
    }
    setWorkingOn(role.id);
    try {
      const { error } = await supabase.from('roles')
        .update({ active })
        .eq('id', role.id).eq('organization_id', organizationId).eq('is_system_role', false);
      if (error) throw error;
      await load();
      setMessage(active ? 'Rol personalizado reactivado.' : 'Rol personalizado desactivado. Sus asignaciones se conservan para una posible reactivación.');
    } catch {
      setMessage('No se pudo cambiar el estado del rol. Revisa tu permiso para administrar roles.');
    } finally { setWorkingOn(null); }
  }

  function isLastActiveOwner(member: MemberRow) {
    if (member.status !== 'ACTIVE') return false;
    const hasOwnerRole = member.member_roles.some(({ roles }) => roles?.key === 'ORGANIZATION_OWNER');
    if (!hasOwnerRole) return false;
    return members.filter((item) => item.status === 'ACTIVE' &&
      item.member_roles.some(({ roles }) => roles?.key === 'ORGANIZATION_OWNER')).length <= 1;
  }

  async function changeMemberStatus(member: MemberRow, status: string) {
    if (!organizationId || !can(PERMISSIONS.USERS_EDIT) || status === member.status) return;
    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status)) return;
    if (member.status === 'ACTIVE' && status !== 'ACTIVE') {
      if (member.user_id === user?.id) {
        setMessage('Tu propia membresía está protegida. Solicita el cambio a otra persona autorizada.');
        return;
      }
      if (isLastActiveOwner(member)) {
        setMessage('Debe permanecer al menos un propietario activo de la inmobiliaria.');
        return;
      }
      if (!window.confirm('¿Confirmas desactivar el acceso de este usuario a la inmobiliaria?')) return;
    }
    const { error } = await supabase
      .from('organization_members')
      .update({ status })
      .eq('id', member.id)
      .eq('organization_id', organizationId);

    if (error) setMessage(error.message);
    else await load();
  }

  async function cancelInvitation(invitationId: string) {
    if(!organizationId || !can(PERMISSIONS.USERS_EDIT))return;
    if(!window.confirm('¿Cancelar esta invitación pendiente? No se eliminará el historial.'))return;
    const {data,error}=await supabase
      .from('organization_invitations')
      .update({ status: 'CANCELLED' })
      .eq('organization_id',organizationId)
      .eq('id', invitationId)
      .eq('status','PENDING')
      .gt('expires_at',new Date().toISOString())
      .select('id')
      .maybeSingle();
    if(error){setMessage('No se pudo cancelar la invitación: '+error.message);return;}
    if(!data){setMessage('La invitación ya no está pendiente o está vencida. Pulsa Actualizar.');return;}
    await load();
    setMessage('Invitación cancelada; permanece en el historial.');
  }

  async function setPortalRelation(
    member: MemberRow,
    relation: 'CONTACT' | 'OWNER',
    targetId: string,
  ) {
    if (!organizationId || !user || !can(PERMISSIONS.USERS_EDIT)) return;

    const existing = portalLinks.find((link) =>
      link.user_id === member.user_id &&
      (relation === 'CONTACT' ? Boolean(link.contact_id) : Boolean(link.owner_id)),
    );

    if (existing) {
      const { error } = await supabase
        .from('portal_access_links')
        .delete()
        .eq('id', existing.id);

      if (error) {
        setMessage(error.message);
        return;
      }
    }

    if (targetId) {
      const { error } = await supabase.from('portal_access_links').insert({
        organization_id: organizationId,
        user_id: member.user_id,
        contact_id: relation === 'CONTACT' ? targetId : null,
        owner_id: relation === 'OWNER' ? targetId : null,
        created_by: user.id,
      });

      if (error) {
        setMessage(error.message);
        return;
      }
    }

    setMessage('Acceso de portal actualizado.');
    await load();
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !canEditPermissions || !can(PERMISSIONS.ROLES_CREATE)) return;

    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const permissionKeys = permissions
      .filter((permission) => form.get('permission_' + permission.id) === 'on')
      .map((permission) => permission.key);

    if (name.length < 2) {
      setMessage('El nombre del rol es obligatorio.');
      return;
    }

    const { error } = await supabase.rpc('create_custom_role', {
      target_org: organizationId,
      role_name: name,
      role_description: description,
      permission_keys: permissionKeys,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Rol personalizado creado correctamente.');
    setShowRoleCreator(false);
    event.currentTarget.reset();
    await load();
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Usuarios, roles y permisos</h1>
          <p className="mt-1 text-sm text-slate-600">
            Controla quién accede al sistema y qué puede hacer dentro de esta inmobiliaria. Los roles marcados se acumulan; no son un selector de vista. Haz clic en un perfil para consultar sus permisos y, si eres administrador, agregar o quitar autorizaciones.
          </p>
          <p className="mt-2 text-xs text-slate-600">Retirar usuario desactiva solo su acceso a esta inmobiliaria, sin borrar su cuenta, contratos ni historial. Los roles base están protegidos; solo los personalizados pueden desactivarse.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold"
          >
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </button>

          {canEditPermissions && can(PERMISSIONS.ROLES_CREATE) && (
            <button
              type="button"
              onClick={() => setShowRoleCreator((value) => !value)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-900 px-4 py-2.5 text-sm font-semibold"
            >
              <ShieldCheck className="h-4 w-4" />
              Crear rol
            </button>
          )}

          {can(PERMISSIONS.USERS_CREATE) && (
            <button
              type="button"
              onClick={() => setShowInvite((value) => !value)}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
            >
              <UserPlus className="h-4 w-4" />
              Invitar usuario
            </button>
          )}
        </div>
      </div>

      {showInvite && (
        <form onSubmit={inviteUser} className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="font-bold">Invitar a la inmobiliaria</h2>
          <p className="mt-1 text-sm text-slate-600">
            Puedes asignar varios roles a la misma persona.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field name="full_name" label="Nombre" />
            <Field name="email" label="Correo electrónico" type="email" required />
          </div>

          <div className="mt-4">
            <div className="mb-2 text-sm font-semibold">Roles iniciales</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {roles.filter((role) => role.active).map((role) => (
                <label key={role.id} className="flex items-start gap-3 rounded-xl border border-stone-200 p-3">
                  <input type="checkbox" name={'role_' + role.id} className="mt-1" />
                  <span>
                    <span className="block text-sm font-semibold">{displayTenantRole(role)}</span>
                    {role.description && <span className="mt-0.5 block text-xs text-slate-500">{role.description}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowInvite(false)} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold">
              Cancelar
            </button>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              Crear invitación
            </button>
          </div>
        </form>
      )}

      {showRoleCreator && (
        <form onSubmit={createRole} className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="font-bold">Crear rol personalizado</h2>
          <p className="mt-1 text-sm text-slate-600">
            Define un perfil propio, por ejemplo: Asesor Junior, Captador, Coordinador de Arriendos o Propietario.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field name="name" label="Nombre del rol" required />
            <Field name="description" label="Descripción" />
          </div>

          <div className="mt-5">
            <div className="mb-3 text-sm font-semibold">Permisos incluidos</div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {permissions.map((permission) => (
                <label key={permission.id} className="flex gap-3 rounded-xl border border-stone-200 p-3">
                  <input type="checkbox" name={'permission_' + permission.id} className="mt-1" />
                  <span>
                    <span className="block text-xs font-semibold text-slate-900">{permission.key}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{permission.description || 'Permiso del sistema'}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowRoleCreator(false)} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold">
              Cancelar
            </button>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              Guardar rol
            </button>
          </div>
        </form>
      )}

      {message && (
        <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm text-slate-700">
          {message}
        </div>
      )}

      <InvitationHistory invitations={invitations} loading={loading}
        error={invitationLoadError} canCancel={can(PERMISSIONS.USERS_EDIT)}
        onCancel={id=>void cancelInvitation(id)}/>

      <div className="rounded-2xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-4">
          <div>
            <h2 className="font-bold">Miembros</h2>
            <div className="text-xs text-slate-500">{members.length} usuarios vinculados</div>
          </div>
          <UsersRound className="h-5 w-5 text-slate-500" />
        </div>

        <div className="divide-y divide-stone-100">
          {members.map((member) => {
            const assignedRoleIds = new Set(member.member_roles.map((item) => item.role_id));
            const profile = profilesById[member.user_id];
            const displayName = profile?.full_name || 'Usuario';

            return (
              <article key={member.id} className="p-5">
                <div className="grid gap-4 lg:grid-cols-[minmax(180px,1fr)_160px_2fr] lg:items-start">
                  <div>
                    <div className="font-semibold">{displayName}</div>
                    <div className="mt-1 font-mono text-[11px] text-slate-400">{member.user_id}</div>
                    {profile?.phone && <div className="mt-1 text-xs text-slate-500">{profile.phone}</div>}
                    {can(PERMISSIONS.USERS_EDIT) && member.status === 'ACTIVE' &&
                      member.user_id !== user?.id && !isLastActiveOwner(member) && (
                        <button type="button" disabled={workingOn !== null}
                          onClick={() => void retireMember(member, displayName)}
                          className="mt-2 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-800 disabled:opacity-40">
                          {workingOn === member.id ? 'Retirando…' : 'Retirar usuario'}
                        </button>
                      )}
                    {can(PERMISSIONS.USERS_EDIT) && member.status === 'INACTIVE' && member.user_id !== user?.id && (
                      <button type="button" disabled={workingOn !== null}
                        onClick={() => void changeMemberStatus(member, 'ACTIVE')}
                        className="mt-2 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40">Restablecer acceso</button>
                    )}
                  </div>

                  <label>
                    <span className="mb-1 block text-xs font-semibold text-slate-500">Estado</span>
                    <select
                      value={member.status}
                      disabled={!can(PERMISSIONS.USERS_EDIT) || (member.status === 'ACTIVE' && (member.user_id === user?.id || isLastActiveOwner(member)))}
                      onChange={(event) => void changeMemberStatus(member, event.target.value)}
                      className="w-full rounded-lg border border-stone-300 px-2 py-2 text-sm disabled:bg-stone-50"
                    >
                      <option value="ACTIVE">Activo</option>
                      <option value="SUSPENDED">Suspendido</option>
                      <option value="INACTIVE">Inactivo</option>
                    </select>
                  </label>

                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 text-xs font-semibold text-slate-500">Roles asignados</div>
                      {member.member_roles.some(x=>x.roles?.key==='ORGANIZATION_OWNER')&&
                       member.member_roles.some(x=>x.roles?.key==='CLIENT')&&
                        <p role="alert" className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                          Esta cuenta es Cliente y también titular administrativo de la inmobiliaria.
                          Conserva permisos elevados: no sirve para probar el acceso restringido.
                          Usa una cuenta diferente únicamente con rol Cliente y su vínculo de portal.
                        </p>}
                      {member.member_roles.some(x=>x.roles?.key==='ORGANIZATION_OWNER')&&
                        <p className="mb-2 text-xs text-slate-600">
                          «Titular de la inmobiliaria» administra la organización.
                          El dueño de un inmueble se vincula en «Portal como propietario»,
                          sin asignar permisos administrativos.
                        </p>}
                      <div className="flex flex-wrap gap-2">
                        {member.member_roles.filter(link=>link.roles?.key==='ORGANIZATION_OWNER')
                          .map(link=><span key={'org-owner-'+link.role_id}
                            className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-950">
                            Titular administrativo de la inmobiliaria · acceso elevado
                          </span>)}
                        {roles.filter((role) => role.active).map((role) => {
                          const checked = assignedRoleIds.has(role.id);
                          return (
                            <label
                              key={role.id}
                              className={
                                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ' +
                                (checked ? 'border-slate-900 bg-slate-900 text-white' : 'border-stone-300 bg-white text-slate-700')
                              }
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!can(PERMISSIONS.ROLES_ASSIGN)}
                                onChange={(event) => void toggleMemberRole(member, role.id, event.target.checked)}
                                className="sr-only"
                              />
                              {checked && <Check className="h-3 w-3" />}
                              {role.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {can(PERMISSIONS.USERS_EDIT) && (
                      <div className="grid gap-3 border-t border-stone-100 pt-3 md:grid-cols-2">
                        <label>
                          <span className="mb-1 block text-xs font-semibold text-slate-500">
                            Portal como cliente
                          </span>
                          <select
                            value={
                              portalLinks.find((link) => link.user_id === member.user_id && link.contact_id)?.contact_id ?? ''
                            }
                            onChange={(event) => void setPortalRelation(member, 'CONTACT', event.target.value)}
                            className="w-full rounded-lg border border-stone-300 px-2 py-2 text-sm"
                          >
                            <option value="">Sin vínculo de cliente</option>
                            {contacts.map((contact) => (
                              <option key={contact.id} value={contact.id}>
                                {[contact.first_name, contact.last_name].filter(Boolean).join(' ')}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span className="mb-1 block text-xs font-semibold text-slate-500">
                            Portal como propietario
                          </span>
                          <select
                            value={
                              portalLinks.find((link) => link.user_id === member.user_id && link.owner_id)?.owner_id ?? ''
                            }
                            onChange={(event) => void setPortalRelation(member, 'OWNER', event.target.value)}
                            className="w-full rounded-lg border border-stone-300 px-2 py-2 text-sm"
                          >
                            <option value="">Sin vínculo de propietario</option>
                            {owners.map((owner) => (
                              <option key={owner.id} value={owner.id}>
                                {[owner.first_name, owner.last_name].filter(Boolean).join(' ')}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                </div>
                {can(PERMISSIONS.USERS_VIEW) && <div className="mt-4 border-t border-stone-100 pt-3">
                  <button type="button" aria-expanded={expandedMemberId===member.id}
                    onClick={()=>setExpandedMemberId(current=>current===member.id?null:member.id)}
                    className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold">
                    {expandedMemberId===member.id?'Ocultar autorizaciones':'Consultar permisos del usuario'}
                  </button>
                  {expandedMemberId===member.id &&
                    <MemberPermissionOverview key={member.id} memberId={member.id}
                      status={member.status} assignments={member.member_roles}
                      allRoles={allRoles} catalog={permissions}/>}
                </div>}
              </article>
            );
          })}

          {!loading && members.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              Todavía no hay miembros visibles.
            </div>
          )}
        </div>
      </div>


      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="font-bold">Roles disponibles</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <div key={role.id} className={'rounded-xl border p-4 '+(selectedRoleId===role.id?'border-slate-900 bg-slate-50':'border-stone-200')}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{role.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{role.description || 'Rol personalizado'}</div>
                </div>
                {role.is_system_role ? (
                  <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide">Base protegida</span>
                ) : can(PERMISSIONS.ROLES_EDIT) ? (
                  <button type="button" disabled={workingOn !== null}
                    onClick={() => void setCustomRoleActive(role, !role.active)}
                    className={'rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-40 ' + (role.active ? 'border-red-200 text-red-800' : 'border-green-200 text-green-800')}>
                    {workingOn === role.id ? 'Guardando…' : role.active ? 'Desactivar rol' : 'Reactivar rol'}
                  </button>
                ) : null}
              </div>
              <div className="mt-3 text-xs text-slate-600">
                {(role.role_permissions ?? []).length} permisos · {role.active ? 'Activo' : 'Desactivado'}
              </div>
              <button type="button" aria-expanded={selectedRoleId===role.id}
                aria-controls="profile-permissions-panel"
                onClick={()=>setSelectedRoleId(current=>current===role.id?null:role.id)}
                className="mt-3 w-full rounded-lg border border-slate-900 bg-white px-3 py-2 text-sm font-semibold hover:bg-stone-100">
                {selectedRoleId===role.id?'Cerrar permisos':'Ver y editar permisos'}
              </button>
            </div>
          ))}
        </div>
        {organizationId&&selectedRoleId&&roles.some(role=>role.id===selectedRoleId)&&
          <div id="profile-permissions-panel">
            <RolePermissionEditor key={selectedRoleId}
              organizationId={organizationId}
              role={roles.find(role=>role.id===selectedRoleId)!}
              permissions={permissions}
              onClose={()=>setSelectedRoleId(null)}
              onSaved={load}
            />
          </div>}
      </div>
    </section>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...inputProps } = props;
  return (
    <label>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input {...inputProps} className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
    </label>
  );
}
