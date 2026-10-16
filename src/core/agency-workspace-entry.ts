/**
 * The INMOJCO marketing homepage is not an agency's private workspace.
 * Normal agency accounts start in their tenant-scoped dashboard, while the
 * independent platform owner may continue using the central landing page.
 *
 * This is navigation only. Database authorization remains enforced by RLS.
 */
export function shouldOpenAgencyWorkspace({
  authenticated,
  hasMembership,
  platformAdmin,
  pathname,
  publicConsignment,
}: {
  authenticated: boolean;
  hasMembership: boolean;
  platformAdmin: boolean;
  pathname: string;
  publicConsignment: boolean;
}): boolean {
  if (!authenticated || !hasMembership || platformAdmin || publicConsignment) return false;
  // The independent public storefront and the platform admin URL must never
  // be overridden by the signed-in tenant's dashboard preference.
  if (pathname === '/super-admin' || pathname.startsWith('/inmobiliaria/')) return false;
  return pathname === '/' || pathname === '/app' || pathname === '/app/';
}
