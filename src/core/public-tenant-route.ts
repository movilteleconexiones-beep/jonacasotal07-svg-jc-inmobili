/**
 * Public and private INMOJCO navigation are independent.
 * The public tenant slug is URL-derived before considering the signed-in user.
 * These helpers are presentation only; backend RLS/RPC remain authoritative.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validSlug(value: string | null | undefined): string {
  const slug = (value || '').trim().toLowerCase();
  return slug.length >= 2 && slug.length <= 80 && SLUG.test(slug) ? slug : '';
}

/** Root is public even with an active tenant session; the backoffice is /app. */
export function isPublicStorefrontPath(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/inmobiliaria/');
}

/**
 * Explicit public tenant URLs win over session and deployment defaults.
 * A malformed explicit slug must fail closed rather than leak the signed-in
 * agency's inventory/brand in a different URL.
 */
export function resolvePublicTenantSlug({
  pathname,
  search,
  membershipSlug,
  configuredSlug,
}: {
  pathname: string;
  search: string;
  membershipSlug?: string | null;
  configuredSlug?: string | null;
}): string {
  if (pathname.startsWith('/inmobiliaria/')) {
    const match = /^\/inmobiliaria\/([^/]+)\/?$/.exec(pathname);
    return match ? validSlug(match[1]) : '';
  }

  const params = new URLSearchParams(search);
  if (params.has('inmobiliaria')) return validSlug(params.get('inmobiliaria'));

  return validSlug(configuredSlug) || validSlug(membershipSlug);
}

/** Direct public link; safe for rendering in any authenticated panel. */
export function tenantPublicPath(slug: string): string {
  const normalized = validSlug(slug);
  return normalized ? `/inmobiliaria/${normalized}` : '/';
}
