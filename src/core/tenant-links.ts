/** Tenant-specific public and private links share the same canonical identifier. */
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeTenantSlug(input: string): string {
  return input.trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,60).replace(/-+$/,'');
}

export function isValidTenantSlug(input: string): boolean {
  return input.length >= 2 && input.length <= 60 && SLUG.test(input);
}

/** Private entry is only a navigation hint: membership + RLS authorize all data. */
export function tenantPrivatePath(slug: string): string {
  return isValidTenantSlug(slug) ? `/app?inmobiliaria=${encodeURIComponent(slug)}` : '/app';
}
