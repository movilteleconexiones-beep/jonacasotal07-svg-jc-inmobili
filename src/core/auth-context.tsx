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
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  selectOrganization: (organizationId: string) => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadMemberships(userId: string): Promise<AuthMembership[]> {
  if (!supabase) return [];

  const { data: memberships, error } = await supabase
    .from('organization_members')
    .select('id, organization_id, user_id, status, joined_at, organizations(*)')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE');

  if (error || !memberships) return [];

  const result: AuthMembership[] = [];

  for (const row of memberships as any[]) {
    const { data: memberRoles } = await supabase
      .from('member_roles')
      .select('roles(id, organization_id, key, name, description, is_system_role, active)')
      .eq('organization_member_id', row.id);

    const roles = (memberRoles ?? [])
      .map((entry: any) => entry.roles)
      .filter(Boolean) as Role[];

    const roleIds = roles.map((role) => role.id);
    let permissions = new Set<string>();

    if (roleIds.length > 0) {
      const { data: rolePermissions } = await supabase
        .from('role_permissions')
        .select('permissions(key)')
        .in('role_id', roleIds);

      for (const item of rolePermissions ?? []) {
        const key = (item as any).permissions?.key;
        if (key) permissions.add(key);
      }
    }

    const { data: overrides } = await supabase
      .from('member_permissions')
      .select('effect, permissions(key)')
      .eq('organization_member_id', row.id);

    for (const item of overrides ?? []) {
      const key = (item as any).permissions?.key;
      if (!key) continue;
      if ((item as any).effect === 'DENY') permissions.delete(key);
      if ((item as any).effect === 'ALLOW') permissions.add(key);
    }

    result.push({
      member: {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        status: row.status,
        joinedAt: row.joined_at ?? undefined,
      },
      organization: {
        id: row.organizations.id,
        name: row.organizations.name,
        slug: row.organizations.slug,
        legalName: row.organizations.legal_name ?? undefined,
        taxId: row.organizations.tax_id ?? undefined,
        email: row.organizations.email ?? undefined,
        phone: row.organizations.phone ?? undefined,
        whatsapp: row.organizations.whatsapp ?? undefined,
        logoUrl: row.organizations.logo_url ?? undefined,
        status: row.organizations.status,
        planId: row.organizations.plan_id ?? undefined,
        createdAt: row.organizations.created_at,
        updatedAt: row.organizations.updated_at,
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
  const [memberships, setMemberships] = useState<AuthMembership[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);

  const refreshMemberships = useCallback(async (userId: string | null) => {
    if (!userId) {
      setMemberships([]);
      setActiveOrganizationId(null);
      return;
    }

    const nextMemberships = await loadMemberships(userId);
    setMemberships(nextMemberships);
    setActiveOrganizationId((current) => {
      if (current && nextMemberships.some((m) => m.organization.id === current)) return current;
      return nextMemberships[0]?.organization.id ?? null;
    });
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await refreshMemberships(data.session?.user.id ?? null);
      if (mounted) setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      await refreshMemberships(nextSession?.user.id ?? null);
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [refreshMemberships]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: 'La autenticación aún no está configurada.' };

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, []);

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
      signIn,
      signOut,
      selectOrganization: setActiveOrganizationId,
      can,
    }),
    [loading, session, memberships, activeMembership, signIn, signOut, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
