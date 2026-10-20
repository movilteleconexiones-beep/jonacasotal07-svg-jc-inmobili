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

export function validPublicPageContent(value: PublicPageContent): boolean {
  return Object.entries(STRING_LIMITS).every(([key, length]) => {
    const item = (value as unknown as Record<string, unknown>)[key];
    return typeof item === 'string' && item.length <= length;
  }) && TOGGLES.every(key => typeof value[key] === 'boolean');
}
