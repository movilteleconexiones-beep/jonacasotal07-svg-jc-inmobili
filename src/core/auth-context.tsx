import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { Organization, OrganizationMember, Role } from './types';
import { parseBillingAccess, type BillingAccess } from './billing-access';
import { canUseTenantPermission, hasVerifiedOperationalRole } from './portal-access-mode';
import { createAuthLoadGate } from './auth-load-gate';

export interface AuthMembership {
  member: OrganizationMember;
  organization: Organization;
  roles: Role[];
  permissions: string[];
  billing: BillingAccess;
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
    const { data: memberRoles, error: rolesError } = await supabase
      .from('member_roles')
      .select('roles(id, organization_id, key, name, description, is_system_role, active)')
      .eq('organization_member_id', row.id);

    // A failed role lookup must not be interpreted as an empty/staff role list.
    if (rolesError || !memberRoles) {
      throw new Error('No se pudieron verificar los roles de la inmobiliaria.');
    }

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

    const org = row.organizations as any;
    // A membership without a readable organization, or one linked to a
    // different organization, must never grant tenant-scoped UI permissions.
    if (!org || !org.id || org.id !== row.organization_id || !roles.length) continue;

    const { data: accessData, error: accessError } = await supabase.rpc('billing_get_access', { target_org: org.id });
    if (accessError) throw new Error('No se pudo verificar la activación de la inmobiliaria.');
    const billing = parseBillingAccess(accessData);

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
      // Plans grant feature entitlements, not internal privileges to CLIENT-only
      // accounts. RLS and per-member permission checks still govern operations.
      permissions: hasVerifiedOperationalRole(roles) ? billing.permissions : [],
      billing,
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

  const authLoadGate = useRef(createAuthLoadGate());
  const currentAuthUserId = useRef<string | null>(null);

  // Never commit an obsolete session's memberships, admin flag or tenant.
  // Results are committed together only when this auth generation is current.
  const loadForUser = useCallback(async (userId: string | null) => {
    const generation = authLoadGate.current.begin();
    try {
      if (!userId) {
        if (authLoadGate.current.isCurrent(generation)) {
          setAccessError(null);
          setMemberships([]);
          setIsPlatformAdmin(false);
          setActiveOrganizationId(null);
        }
        return;
      }

      // Invitation claiming is best-effort: failure must not prevent access
      // to a previously verified membership.
      try {
        const { error: invitationError } = await supabase.rpc('claim_my_invitations');
        if (invitationError) console.warn('Unable to claim invitations', invitationError.message);
      } catch (invitationError) {
        console.warn('Unable to claim invitations', invitationError);
      }
      if (!authLoadGate.current.isCurrent(generation)) return;

      const { data: admin, error: adminError } = await supabase.from('platform_admins')
        .select('user_id,admin_level,active').eq('user_id', userId).eq('active',true)
        .in('admin_level',['SUPER_ADMIN','PLATFORM_OWNER']).maybeSingle();
      if (!authLoadGate.current.isCurrent(generation)) return;

      const nextMemberships = await loadMemberships(userId);
      if (!authLoadGate.current.isCurrent(generation)) return;

      if (adminError) console.warn('Unable to verify platform administrator', adminError.message);
      setIsPlatformAdmin(!adminError && admin?.user_id === userId);
      setAccessError(adminError ? 'No se pudo verificar el acceso administrativo. Intenta actualizar el acceso.' : null);
      setMemberships(nextMemberships);
      setActiveOrganizationId((current) => {
        if (current && nextMemberships.some((membership) => membership.organization.id === current)) return current;
        return nextMemberships[0]?.organization.id ?? null;
      });
    } catch (loadError) {
      if (authLoadGate.current.isCurrent(generation)) {
        setMemberships([]);
        setActiveOrganizationId(null);
        setIsPlatformAdmin(false);
        setAccessError('No se pudieron consultar las inmobiliarias. Intenta actualizar el acceso.');
      }
      throw loadError;
    } finally {
      if (authLoadGate.current.isCurrent(generation)) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // A partial staging configuration must not attempt authentication.
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let mounted = true;
    let authEventVersion = 0;

    // Invalidate old requests synchronously with a change of session.
    // An obsolete asynchronous query can never restore the old agency.
    const applySession = (nextSession: Session | null): string | null => {
      authLoadGate.current.invalidate();
      const nextUserId = nextSession?.user.id ?? null;
      if (currentAuthUserId.current !== nextUserId) {
        currentAuthUserId.current = nextUserId;
        setMemberships([]);
        setActiveOrganizationId(null);
        setIsPlatformAdmin(false);
        setAccessError(null);
      }
      setSession(nextSession);
      setLoading(true);
      return nextUserId;
    };

    void supabase.auth.getSession().then(({ data, error }) => {
      // INITIAL_SESSION or SIGNED_IN may have arrived before getSession.
      if (!mounted || authEventVersion !== 0) return;
      const userId = applySession(error ? null : data.session);
      void loadForUser(userId).catch((loadError) => {
        if (mounted) console.error('Unable to load organization memberships', loadError);
      });
    }).catch((loadError) => {
      if (!mounted || authEventVersion !== 0) return;
      console.error('Unable to initialize authentication', loadError);
      applySession(null);
      setAccessError('No se pudo inicializar la sesión. Intenta nuevamente.');
      setLoading(false);
    });

    // Supabase warns against awaiting API queries inside this callback.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      const version = ++authEventVersion;
      const userId = applySession(nextSession);
      setTimeout(() => {
        if (!mounted || version !== authEventVersion) return;
        void loadForUser(userId).catch((loadError) => {
          if (mounted && version === authEventVersion)
            console.error('Unable to refresh memberships', loadError);
        });
      }, 0);
    });

    return () => {
      mounted = false;
      authLoadGate.current.invalidate();
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
    (permission: string) => Boolean(activeMembership &&
      canUseTenantPermission(activeMembership.roles, activeMembership.permissions, permission)),
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
