export interface CountryOption {
  code: string;
  name: string;
  locale: string;
  currency: string;
  timezone: string;
  language: 'es' | 'pt';
}

export const LATAM_COUNTRIES: CountryOption[] = [
  { code: 'CO', name: 'Colombia', locale: 'es-CO', currency: 'COP', timezone: 'America/Bogota', language: 'es' },
  { code: 'MX', name: 'México', locale: 'es-MX', currency: 'MXN', timezone: 'America/Mexico_City', language: 'es' },
  { code: 'PE', name: 'Perú', locale: 'es-PE', currency: 'PEN', timezone: 'America/Lima', language: 'es' },
  { code: 'CL', name: 'Chile', locale: 'es-CL', currency: 'CLP', timezone: 'America/Santiago', language: 'es' },
  { code: 'AR', name: 'Argentina', locale: 'es-AR', currency: 'ARS', timezone: 'America/Argentina/Buenos_Aires', language: 'es' },
  { code: 'EC', name: 'Ecuador', locale: 'es-EC', currency: 'USD', timezone: 'America/Guayaquil', language: 'es' },
  { code: 'PA', name: 'Panamá', locale: 'es-PA', currency: 'PAB', timezone: 'America/Panama', language: 'es' },
  { code: 'CR', name: 'Costa Rica', locale: 'es-CR', currency: 'CRC', timezone: 'America/Costa_Rica', language: 'es' },
  { code: 'GT', name: 'Guatemala', locale: 'es-GT', currency: 'GTQ', timezone: 'America/Guatemala', language: 'es' },
  { code: 'DO', name: 'República Dominicana', locale: 'es-DO', currency: 'DOP', timezone: 'America/Santo_Domingo', language: 'es' },
  { code: 'UY', name: 'Uruguay', locale: 'es-UY', currency: 'UYU', timezone: 'America/Montevideo', language: 'es' },
  { code: 'PY', name: 'Paraguay', locale: 'es-PY', currency: 'PYG', timezone: 'America/Asuncion', language: 'es' },
  { code: 'BO', name: 'Bolivia', locale: 'es-BO', currency: 'BOB', timezone: 'America/La_Paz', language: 'es' },
  { code: 'HN', name: 'Honduras', locale: 'es-HN', currency: 'HNL', timezone: 'America/Tegucigalpa', language: 'es' },
  { code: 'SV', name: 'El Salvador', locale: 'es-SV', currency: 'USD', timezone: 'America/El_Salvador', language: 'es' },
  { code: 'NI', name: 'Nicaragua', locale: 'es-NI', currency: 'NIO', timezone: 'America/Managua', language: 'es' },
  { code: 'BR', name: 'Brasil', locale: 'pt-BR', currency: 'BRL', timezone: 'America/Sao_Paulo', language: 'pt' },
];

export const DEFAULT_COUNTRY_CODE = 'CO';

export function getCountryOption(code: string) {
  return LATAM_COUNTRIES.find((country) => country.code === code) ?? LATAM_COUNTRIES[0];
}
