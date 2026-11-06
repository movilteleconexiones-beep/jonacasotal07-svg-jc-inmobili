/** Browser-only validation; Supabase RLS remains authoritative. */
export const ALLOWED_LEAD_STATUSES = [
  'NEW','CONTACTED','QUALIFIED','VISIT_SCHEDULED','NEGOTIATION','WON','LOST',
] as const;

export function isLeadStatus(value: string): boolean {
  return ALLOWED_LEAD_STATUSES.some(code => code === value);
}

export interface LeadDraft {
  contactId: string;
  propertyId: string;
  minBudget: number | null;
  maxBudget: number | null;
}

export function validateLeadDraft(
  input: LeadDraft,
  visibleContacts: ReadonlyArray<{id:string}>,
  visibleProperties: ReadonlyArray<{id:string}>,
): string | null {
  if (!input.contactId || !visibleContacts.some(row => row.id === input.contactId))
    return 'Selecciona un contacto válido de esta inmobiliaria.';
  if (input.propertyId && !visibleProperties.some(row => row.id === input.propertyId))
    return 'Selecciona una propiedad válida de esta inmobiliaria.';
  const { minBudget, maxBudget } = input;
  if ([minBudget,maxBudget].some(value => value !== null && (!Number.isFinite(value) || value < 0)) ||
      (minBudget !== null && maxBudget !== null && minBudget > maxBudget))
    return 'El presupuesto debe ser válido, no negativo y el mínimo no puede superar al máximo.';
  return null;
}
