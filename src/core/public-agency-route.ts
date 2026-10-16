/** Public tenant routing never trusts a client-provided organization UUID.
 *  Tenant slugs are resolved against an enabled site by the database. */
const SLUG = /^[a-z0-9][a-z0-9-]{2,79}$/;

export function publicAgencySlug(pathname: string): string | null {
  const match = /^\/inmobiliaria\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  const slug = match[1];
  return SLUG.test(slug) ? slug : null;
}

export function publicConsignmentSlug(pathname: string, defaultSlug?: string): string | null {
  const routeSlug = publicAgencySlug(pathname);
  if (pathname.startsWith('/inmobiliaria/')) return routeSlug;
  const configured = defaultSlug?.trim();
  return configured && SLUG.test(configured) ? configured : null;
}

export function publicAgencyUrl(slug: string) {
  if (!SLUG.test(slug)) throw new Error('Identificador de inmobiliaria no válido');
  return `/inmobiliaria/${slug}`;
}
