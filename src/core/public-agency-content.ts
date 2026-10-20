/** Only marketing fields deliberately published by the agency may reach the public site. */
export interface PublicAgencyService {
  title: string;
  description: string;
}

export function parsePublicAgencyServices(value: unknown): PublicAgencyService[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((entry): PublicAgencyService[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.title !== 'string' || typeof row.description !== 'string') return [];
    const title = row.title.trim().slice(0, 90);
    const description = row.description.trim().slice(0, 420);
    return title && description ? [{ title, description }] : [];
  });
}

/** Data-neutral fallback: it never claims that an unconfigured tenant offers a service. */
export const AGENCY_SERVICE_PROMPT =
  'Esta inmobiliaria todavía no ha publicado su portafolio de servicios. Comunícate con su equipo para conocer las opciones disponibles.';

export function agencyHeroCopy(
  companyName: string,
  headline: string | undefined,
  description: string | undefined,
  country: string,
) {
  return {
    title: headline?.trim() || `Bienvenido a ${companyName}`,
    description: description?.trim() || `Explora el portafolio publicado por ${companyName} en ${country} y consulta directamente las condiciones de sus servicios.`,
  };
}
