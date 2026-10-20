/**
 * The private workspace is accessible only at /app.
 * Signing in must NOT replace / or /inmobiliaria/:slug with the backoffice.
 * This is frontend navigation; database access remains protected by RLS.
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
  return authenticated &&
    (hasMembership || platformAdmin) &&
    !publicConsignment &&
    (pathname === '/app' || pathname === '/app/');
}
