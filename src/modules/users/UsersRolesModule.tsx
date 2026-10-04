import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  Clock3,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';

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

interface InvitationRow {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  expires_at: string;
  created_at: string;
  invitation_roles: Array<{
    role_id: string;
    roles: { id: string; name: string; key: string | null } | null;
  }>;
}

export function UsersRolesModule() {
  const { user, activeMembership, can } = useAuth();
  const organizationId = activeMembership?.organization.id;

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [profilesById, setProfilesById] = useState<Record<string, { full_name: string | null; phone: string | null; avatar_url: string | null }>>({});
  const [showInvite, setShowInvite] = useState(false);
  const [showRoleCreator, setShowRoleCreator] = useState(false);

  async function load() {
    if (!organizationId) return;
    setLoading(true);
    setMessage('');

    const [membersResult, rolesResult, permissionsResult, invitationsResult] = await Promise.all([
      supabase
        .from('organization_members')
        .select('id,user_id,status,joined_at,member_roles(role_id,roles(id,name,key))')
        .eq('organization_id', organizationId)
        .order('created_at'),
      supabase
        .from('roles')
        .select('id,name,key,description,is_system_role,active,role_permissions(permissions(key))')
        .eq('organization_id', organizationId)
        .eq('active', true)
        .order('is_system_role', { ascending: false })
        .order('name'),
      supabase
        .from('permissions')
        .select('id,key,description')
        .order('key'),
      supabase
        .from('organization_invitations')
        .select('id,email,full_name,status,expires_at,created_at,invitation_roles(role_id,roles(id,name,key))')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }),
    ]);

    if (membersResult.error) setMessage(membersResult.error.message);
    if (rolesResult.error) setMessage((current) => current || rolesResult.error!.message);
    if (permissionsResult.error) setMessage((current) => current || permissionsResult.error!.message);
    if (invitationsResult.error) setMessage((current) => current || invitationsResult.error!.message);

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

    setRoles((rolesResult.data ?? []) as unknown as RoleRow[]);
    setPermissions((permissionsResult.data ?? []) as PermissionRow[]);
    setInvitations((invitationsResult.data ?? []) as unknown as InvitationRow[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !user) return;

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const fullName = String(form.get('full_name') ?? '').trim();
    const selectedRoleIds = roles
      .filter((role) => form.get('role_' + role.id) === 'on')
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
    if (!can(PERMISSIONS.ROLES_ASSIGN)) return;

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

  async function changeMemberStatus(member: MemberRow, status: string) {
    const { error } = await supabase
      .from('organization_members')
      .update({ status })
      .eq('id', member.id);

    if (error) setMessage(error.message);
    else await load();
  }

  async function cancelInvitation(invitationId: string) {
    const { error } = await supabase
      .from('organization_invitations')
      .update({ status: 'CANCELLED' })
      .eq('id', invitationId);

    if (error) setMessage(error.message);
    else await load();
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;

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

  const pendingInvitations = useMemo(
    () => invitations.filter((invitation) => invitation.status === 'PENDING'),
    [invitations],
  );

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Usuarios, roles y permisos</h1>
          <p className="mt-1 text-sm text-slate-600">
            Controla quién accede al sistema y qué puede hacer dentro de esta inmobiliaria.
          </p>
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

          {can(PERMISSIONS.ROLES_CREATE) && (
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
              {roles.map((role) => (
                <label key={role.id} className="flex items-start gap-3 rounded-xl border border-stone-200 p-3">
                  <input type="checkbox" name={'role_' + role.id} className="mt-1" />
                  <span>
                    <span className="block text-sm font-semibold">{role.name}</span>
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
                  </div>

                  <label>
                    <span className="mb-1 block text-xs font-semibold text-slate-500">Estado</span>
                    <select
                      value={member.status}
                      disabled={!can(PERMISSIONS.USERS_EDIT)}
                      onChange={(event) => void changeMemberStatus(member, event.target.value)}
                      className="w-full rounded-lg border border-stone-300 px-2 py-2 text-sm disabled:bg-stone-50"
                    >
                      <option value="ACTIVE">Activo</option>
                      <option value="SUSPENDED">Suspendido</option>
                      <option value="INACTIVE">Inactivo</option>
                    </select>
                  </label>

                  <div>
                    <div className="mb-2 text-xs font-semibold text-slate-500">Roles asignados</div>
                    <div className="flex flex-wrap gap-2">
                      {roles.map((role) => {
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
                </div>
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

      {pendingInvitations.length > 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-5 py-4">
            <h2 className="font-bold">Invitaciones pendientes</h2>
          </div>
          <div className="divide-y divide-stone-100">
            {pendingInvitations.map((invitation) => (
              <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div>
                  <div className="font-semibold">{invitation.full_name || invitation.email}</div>
                  <div className="mt-1 text-xs text-slate-500">{invitation.email}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {invitation.invitation_roles.map((item) => (
                      <span key={item.role_id} className="rounded-full bg-stone-100 px-2 py-1 text-[11px] font-medium">
                        {item.roles?.name ?? 'Rol'}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                    <Clock3 className="h-3.5 w-3.5" />
                    Pendiente
                  </span>
                  {can(PERMISSIONS.USERS_EDIT) && (
                    <button
                      type="button"
                      onClick={() => void cancelInvitation(invitation.id)}
                      className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="font-bold">Roles disponibles</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <div key={role.id} className="rounded-xl border border-stone-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{role.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{role.description || 'Rol personalizado'}</div>
                </div>
                {role.is_system_role && (
                  <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide">
                    Base
                  </span>
                )}
              </div>
              <div className="mt-3 text-xs text-slate-600">
                {(role.role_permissions ?? []).length} permisos
              </div>
            </div>
          ))}
        </div>
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
