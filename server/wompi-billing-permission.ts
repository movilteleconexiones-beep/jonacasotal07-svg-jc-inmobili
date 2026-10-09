/** Explicit, least-privilege permission for creating paid tenant orders. */
export const BILLING_MANAGE_PERMISSION = 'billing.manage' as const;

/**
 * Fail closed until the permission is explicitly provisioned and granted.
 * Do not substitute settings.edit, roles.assign, platform-admin visibility,
 * or an agency-owner label for a billing permission.
 */
export function hasExplicitBillingPermission(
  permissionKeys: readonly string[] | null | undefined,
): boolean {
  return Array.isArray(permissionKeys)
    && permissionKeys.includes(BILLING_MANAGE_PERMISSION);
}
