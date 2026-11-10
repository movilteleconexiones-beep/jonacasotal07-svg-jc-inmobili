/**
 * Explicit, allowlisted public page sections. Never inject user-supplied HTML
 * or interpret tenant data as links, CSS or JavaScript.
 */
export interface PublicPageContent {
  introLabel: string;
  catalogTitle: string;
  servicesTitle: string;
  servicesDescription: string;
  contactTitle: string;
  contactDescription: string;
  footerDescription: string;
  privacyPolicyUrl: string;
  showCatalog: boolean;
  showServices: boolean;
  showCalculator: boolean;
  showContact: boolean;
}

export const DEFAULT_PUBLIC_PAGE: PublicPageContent = {
  introLabel: '',
  catalogTitle: 'Propiedades en Venta, Renta y Administración',
  servicesTitle: '',
  servicesDescription: 'Consulta directamente con esta inmobiliaria la disponibilidad, condiciones y alcance de los servicios publicados.',
  contactTitle: '',
  contactDescription: '',
  footerDescription: '',
  privacyPolicyUrl: '',
  showCatalog: true,
  showServices: true,
  showCalculator: true,
  showContact: true,
};

const STRING_LIMITS: Record<string, number> = {
  introLabel: 130,
  catalogTitle: 130,
  servicesTitle: 130,
  servicesDescription: 420,
  contactTitle: 130,
  contactDescription: 420,
  footerDescription: 420,
  privacyPolicyUrl: 1500,
};
const TOGGLES = ['showCatalog','showServices','showCalculator','showContact'] as const;

export function parsePublicPageContent(value: unknown): PublicPageContent {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_PUBLIC_PAGE };
  for (const [key, length] of Object.entries(STRING_LIMITS)) {
    const raw = data[key];
    if (typeof raw === 'string') {
      (result as unknown as Record<string, unknown>)[key] = raw.trim().slice(0, length);
    }
  }
  for (const key of TOGGLES) {
    if (typeof data[key] === 'boolean') result[key] = data[key] as boolean;
  }
  return result;
}

/**
 * Validates the link shape for an agency privacy notice; this is not legal
 * approval or a live HTTP/content check. Never enable CRM intake from the
 * platform home page or another INMOJCO screen posing as a privacy notice.
 */
export function safePrivacyPolicyDocumentUrl(value: string | null | undefined): string | null {
  if (!value || value.trim().length > STRING_LIMITS.privacyPolicyUrl) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (hostname === 'inmojco.com' || hostname === 'www.inmojco.com') {
      const path = url.pathname.toLowerCase();
      const policyRoute =
        /^\/politicas\/[^/]+/.test(path) ||
        /^\/(?:politica-de-datos|politica-de-privacidad|privacidad)(?:\/|$)/.test(path);
      if (!policyRoute) return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function validPublicPageContent(value: PublicPageContent): boolean {
  return Object.entries(STRING_LIMITS).every(([key, length]) => {
    const item = (value as unknown as Record<string, unknown>)[key];
    return typeof item === 'string' && item.length <= length;
  }) && TOGGLES.every(key => typeof value[key] === 'boolean')
    && (!value.privacyPolicyUrl || Boolean(safePrivacyPolicyDocumentUrl(value.privacyPolicyUrl)));
}
