/**
 * Selection-only business rules. A property owner may hold many property_ownerships;
 * IDs are the authoritative links, never inventory code or owner document number.
 */
export interface OwnershipOption {
  owner_id: string;
  is_primary: boolean;
}

export interface LinkedRentalProperty {
  id: string;
  code: string;
  title: string;
  status: string;
  operation_type: string;
  has_active_lease: boolean;
}

/** Autoselect only with a single unambiguous owner or primary designation. */
export function automaticOwnerId(links: OwnershipOption[]): string | null {
  const unique = [...new Map(links.map(link => [link.owner_id, link])).values()];
  if (unique.length === 1) return unique[0].owner_id;
  const primaries = unique.filter(link => link.is_primary);
  return primaries.length === 1 ? primaries[0].owner_id : null;
}

/** A status alone is insufficient if the property still has an active lease. */
export function canPrepareRental(property: LinkedRentalProperty): boolean {
  return ['RENT', 'SALE_OR_RENT'].includes(property.operation_type)
    && ['AVAILABLE', 'DRAFT', 'RESERVED', 'NEGOTIATION'].includes(property.status)
    && !property.has_active_lease;
}

export function rentalAvailability(property: LinkedRentalProperty): string {
  if (property.has_active_lease) return 'Contrato activo · no disponible';
  if (!['RENT', 'SALE_OR_RENT'].includes(property.operation_type)) return 'No habilitado para arriendo';
  if (property.status === 'RENTED') return 'Arrendado · no disponible';
  if (['SOLD', 'INACTIVE'].includes(property.status)) return 'No disponible';
  if (property.status === 'AVAILABLE') return 'Disponible';
  if (property.status === 'DRAFT') return 'Borrador de inventario · revisar';
  if (['RESERVED', 'NEGOTIATION'].includes(property.status)) return 'Reservado/en negociación · revisar';
  return 'Estado no verificado';
}
