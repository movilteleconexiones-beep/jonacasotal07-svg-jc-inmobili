/** Deal calendar fields are stored as ISO YYYY-MM-DD, independent of browser locale. */
export function isValidDealCloseDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const DEAL_STAGE_OPTIONS = [
  ['INTEREST', 'Interés'],
  ['VISIT', 'Visita'],
  ['OFFER', 'Oferta recibida'],
  ['NEGOTIATION', 'Negociación'],
  ['DOCUMENTATION', 'Documentación'],
  ['CLOSING', 'Cierre'],
  ['WON', 'Cerrado / ganado'],
  ['LOST', 'Cerrado / perdido'],
] as const;

export function isAllowedDealStage(value: string): boolean {
  return DEAL_STAGE_OPTIONS.some(([code]) => code === value);
}
