import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { Organization, OrganizationMember, Role } from './types';

export interface AuthMembership {
  member: OrganizationMember;
  organization: Organization;
  roles: Role[];
  permissions: string[];
}

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: SupabaseUser | null;
  memberships: AuthMembership[];
  activeMembership: AuthMembership | null;
  isPlatformAdmin: boolean;
  accessError: string | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error?: string; needsEmailConfirmation?: boolean }>;
  signOut: () => Promise<void>;
  createOrganization: (name: string, slug: string, countryCode?: string) => Promise<{ error?: string; organizationId?: string }>;
  refreshMemberships: () => Promise<void>;
  selectOrganization: (organizationId: string) => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadMemberships(userId: string): Promise<AuthMembership[]> {
  const { data: memberships, error } = await supabase
    .from('organization_members')
    .select('id, organization_id, user_id, status, joined_at, organizations(*)')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE');

  if (error) throw new Error(`No se pudieron consultar las membresías: ${error.message}`);
  if (!memberships) return [];

  const result: AuthMembership[] = [];

  for (const row of memberships as any[]) {
    const { data: memberRoles, error: memberRolesError } = await supabase
      .from('member_roles')
      .select('roles(id, organization_id, key, name, description, is_system_role, active)')
      .eq('organization_member_id', row.id);
    if (memberRolesError) throw new Error(`No se pudieron verificar los roles: ${memberRolesError.message}`);

    const roles: Role[] = (memberRoles ?? [])
      .map((entry: any) => entry.roles)
      .filter((role: any) =>
        Boolean(role) && Boolean(role.active) &&
        (!role.organization_id || role.organization_id === row.organization_id),
      )
      .map((role: any) => ({
        id: role.id,
        organizationId: role.organization_id ?? undefined,
        key: role.key ?? undefined,
        name: role.name,
        description: role.description ?? undefined,
        isSystemRole: Boolean(role.is_system_role),
        active: Boolean(role.active),
      }));

    const roleIds = roles.map((role) => role.id);
    const permissions = new Set<string>();

    if (roleIds.length > 0) {
      const { data: rolePermissions, error: rolePermissionsError } = await supabase
        .from('role_permissions')
        .select('permissions(key)')
        .in('role_id', roleIds);
      if (rolePermissionsError) throw new Error(`No se pudieron verificar los permisos de roles: ${rolePermissionsError.message}`);

      for (const item of rolePermissions ?? []) {
        const key = (item as any).permissions?.key;
        if (key) permissions.add(key);
      }
    }

    const { data: overrides, error: overridesError } = await supabase
      .from('member_permissions')
      .select('effect, permissions(key)')
      .eq('organization_member_id', row.id);
    if (overridesError) throw new Error(`No se pudieron verificar los permisos individuales: ${overridesError.message}`);

    for (const item of overrides ?? []) {
      const key = (item as any).permissions?.key;
      if (!key) continue;
      if ((item as any).effect === 'DENY') permissions.delete(key);
      if ((item as any).effect === 'ALLOW') permissions.add(key);
    }

    const org = row.organizations as any;
    // A membership without a readable organization, or one linked to a
    // different organization, must never grant tenant-scoped UI permissions.
    if (!org || !org.id || org.id !== row.organization_id) continue;

    result.push({
      member: {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        status: row.status,
        joinedAt: row.joined_at ?? undefined,
      },
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        legalName: org.legal_name ?? undefined,
        taxId: org.tax_id ?? undefined,
        email: org.email ?? undefined,
        phone: org.phone ?? undefined,
        whatsapp: org.whatsapp ?? undefined,
        logoUrl: org.logo_url ?? undefined,
        status: org.status,
        planId: org.plan_id ?? undefined,
        createdAt: org.created_at,
        updatedAt: org.updated_at,
      },
      roles,
      permissions: [...permissions],
    });
  }

  return result;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<AuthMembership[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);

  const loadForUser = useCallback(async (userId: string | null) => {
    if (!userId) {
      setAccessError(null);
      setMemberships([]);
      setIsPlatformAdmin(false);
      setActiveOrganizationId(null);
      return;
    }

    // Invitation claiming is best-effort: a temporary RPC failure must not
    // prevent an existing user from loading their organizations.
    try {
      const { error: invitationError } = await supabase.rpc('claim_my_invitations');
      if (invitationError) console.warn('Unable to claim invitations', invitationError.message);
    } catch (invitationError) {
      console.warn('Unable to claim invitations', invitationError);
    }
    const { data: admin, error: adminError } = await supabase.from('platform_admins').select('user_id,admin_level,active').eq('user_id', userId).eq('active',true).in('admin_level',['SUPER_ADMIN','PLATFORM_OWNER']).maybeSingle();
    setIsPlatformAdmin(!adminError && admin?.user_id === userId);
    if (adminError) console.warn('Unable to verify platform administrator', adminError.message);
    const nextMemberships = await loadMemberships(userId);
    setAccessError(adminError ? 'No se pudo verificar el acceso administrativo. Intenta actualizar el acceso.' : null);
    setMemberships(nextMemberships);
    setActiveOrganizationId((current) => {
      if (current && nextMemberships.some((m) => m.organization.id === current)) return current;
      return nextMemberships[0]?.organization.id ?? null;
    });
  }, []);

  useEffect(() => {
    // A partial staging configuration must not attempt any authentication requests.
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!mounted) return;
      setSession(error ? null : data.session);
      try {
        await loadForUser(error ? null : data.session?.user.id ?? null);
      } catch (loadError) {
        console.error('Unable to load organization memberships', loadError);
        if (mounted) {
          setMemberships([]);
          setIsPlatformAdmin(false);
          setActiveOrganizationId(null);
          setAccessError('No se pudieron consultar las inmobiliarias. Intenta actualizar el acceso.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }).catch((error) => {
      console.error('Unable to initialize authentication', error);
      if (mounted) setLoading(false);
    });

    // Supabase warns against awaiting other Supabase calls inside this callback.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setTimeout(() => {
        if (!mounted) return;
        void loadForUser(nextSession?.user.id ?? null)
          .catch((error) => {
            console.error('Unable to refresh memberships', error);
            if (mounted) setAccessError('No se pudieron consultar las inmobiliarias. Intenta actualizar el acceso.');
          })
          .finally(() => {
            if (mounted) setLoading(false);
          });
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadForUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const emailRedirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/`
        : undefined;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo,
      },
    });

    if (error) return { error: error.message };

    return {
      needsEmailConfirmation: !data.session,
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const refreshMemberships = useCallback(async () => {
    await loadForUser(session?.user.id ?? null);
  }, [loadForUser, session?.user.id]);

  const createOrganization = useCallback(
    async (name: string, slug: string, countryCode = 'CO') => {
      if (!session?.user) return { error: 'Debes iniciar sesión primero.' };

      const { data, error } = await supabase.rpc('create_organization_with_owner', {
        org_name: name.trim(),
        org_slug: slug.trim().toLowerCase(),
        org_country_code: countryCode.toUpperCase(),
      });

      if (error) return { error: error.message };

      await loadForUser(session.user.id);
      return { organizationId: data as string };
    },
    [loadForUser, session?.user],
  );

  const activeMembership = useMemo(
    () => memberships.find((item) => item.organization.id === activeOrganizationId) ?? null,
    [memberships, activeOrganizationId],
  );

  const can = useCallback(
    (permission: string) => activeMembership?.permissions.includes(permission) ?? false,
    [activeMembership],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isSupabaseConfigured,
      loading,
      session,
      user: session?.user ?? null,
      memberships,
      activeMembership,
      isPlatformAdmin,
      accessError,
      signIn,
      signUp,
      signOut,
      createOrganization,
      refreshMemberships,
      selectOrganization: setActiveOrganizationId,
      can,
    }),
    [
      loading,
      session,
      memberships,
      activeMembership,
      isPlatformAdmin,
      accessError,
      signIn,
      signUp,
      signOut,
      createOrganization,
      refreshMemberships,
      can,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
