/**
 * A public intake site response may only be used for its requested agency.
 * Never trust a cached or unexpected RPC payload to select a different tenant.
 */
export interface PublicPropertyIntakeSite {
  slug: string;
  company_name: string;
  country: string;
  currency: string;
}

export function isIntakeSiteForSlug(value: unknown, requestedSlug: string): value is PublicPropertyIntakeSite {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug) ||
      !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const site = value as Record<string, unknown>;
  return site.slug === requestedSlug &&
    typeof site.company_name === 'string' && site.company_name.trim().length > 0 &&
    typeof site.country === 'string' && /^[A-Z]{2}$/.test(site.country) &&
    typeof site.currency === 'string' && /^[A-Z]{3}$/.test(site.currency);
}
