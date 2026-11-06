/** Frontend preflight only: RLS remains the authoritative tenant boundary. */
export const APPOINTMENT_STATUSES = [
  'SCHEDULED','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW',
] as const;

export function isAppointmentStatus(status: string): boolean {
  return APPOINTMENT_STATUSES.some(code => code === status);
}

export interface AppointmentDraft {
  contactId: string;
  propertyId: string;
  startsAt: string;
  endsAt: string;
}

export function validateAppointmentDraft(
  draft: AppointmentDraft,
  contacts: ReadonlyArray<{id:string}>,
  properties: ReadonlyArray<{id:string}>,
  nowMs: number = Date.now(),
): string | null {
  if (draft.contactId && !contacts.some(contact => contact.id === draft.contactId))
    return 'Selecciona un cliente válido de esta inmobiliaria.';
  if (draft.propertyId && !properties.some(property => property.id === draft.propertyId))
    return 'Selecciona un inmueble válido de esta inmobiliaria.';
  const start = new Date(draft.startsAt);
  const end = draft.endsAt ? new Date(draft.endsAt) : null;
  if (!Number.isFinite(start.getTime()) || start.getTime() < nowMs ||
      (end && (!Number.isFinite(end.getTime()) || end <= start)))
    return 'Verifica las fechas: el inicio no puede estar en el pasado y el fin debe ser posterior al inicio.';
  return null;
}
