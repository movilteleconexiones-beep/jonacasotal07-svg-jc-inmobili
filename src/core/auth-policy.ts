export interface MembershipIdentity {
  user_id: string;
  status: string;
  organization_id: string;
  organizations?: { id?: string } | null;
}

export function isValidMembership(row: MembershipIdentity, userId: string): boolean {
  return row.user_id === userId &&
    row.status === 'ACTIVE' &&
    Boolean(row.organizations?.id) &&
    row.organizations?.id === row.organization_id;
}

export interface PermissionOverride {
  effect: string;
  permissions?: { key?: string | null } | { key?: string | null }[] | null;
}

export function resolveEffectivePermissions(
  inherited: Iterable<string>,
  overrides: PermissionOverride[],
): string[] {
  const permissions = new Set(inherited);
  const denied = new Set<string>();
  for (const item of overrides) {
    const relations = Array.isArray(item.permissions) ? item.permissions : [item.permissions];
    for (const relation of relations) {
      const key = relation?.key;
      if (!key) continue;
      if (item.effect === 'DENY') denied.add(key);
      if (item.effect === 'ALLOW') permissions.add(key);
    }
  }
  for (const key of denied) permissions.delete(key);
  return [...permissions];
}

export interface ScopedRole {
  id: string;
  active?: boolean | null;
  organization_id?: string | null;
}

export function eligibleRolesForOrganization(
  entries: Array<{ roles?: ScopedRole | ScopedRole[] | null }>,
  organizationId: string,
): ScopedRole[] {
  return entries
    .flatMap((entry) => Array.isArray(entry.roles) ? entry.roles : [entry.roles])
    .filter((role): role is ScopedRole =>
      Boolean(role?.id) &&
      role?.active === true &&
      role.organization_id === organizationId,
    );
}
