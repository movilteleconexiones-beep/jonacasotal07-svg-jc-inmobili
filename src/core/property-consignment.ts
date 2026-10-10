export interface PropertyConsignmentInput {
  title: string;
  operation_type: 'SALE' | 'RENT' | 'ADMINISTRATION';
  property_type: 'HOUSE' | 'APARTMENT' | 'COMMERCIAL';
  price: number;
  lot_area: number;
  built_area: number;
  bedrooms: number;
  bathrooms: number;
  parking_spaces: number;
  administration_fee: number;
  construction_year: number | null;
  state: string;
  city: string;
  neighborhood: string;
  description: string;
  owner_name: string;
  owner_phone: string;
  contact_consent: boolean;
}

/** Mirrors the public intake contract; the database remains authoritative. */
export function validatePropertyConsignment(input: PropertyConsignmentInput, year = new Date().getFullYear()): string | null {
  if (input.title.trim().length < 5 || input.title.trim().length > 160 || input.description.trim().length > 2000) {
    return 'Ingresa un título de 5 a 160 caracteres y una descripción de hasta 2000.';
  }
  if (input.owner_name.trim().length < 3 || input.owner_name.trim().length > 120 ||
    !/^[+0-9 ()-]+$/.test(input.owner_phone) || input.owner_phone.length > 40 ||
    !/^[0-9]{7,15}$/.test(input.owner_phone.replace(/\D/g, ''))) {
    return 'Ingresa un nombre de 3 a 120 caracteres y un teléfono válido de 7 a 15 dígitos.';
  }
  if (!input.state.trim() || !input.city.trim() || input.state.trim().length > 120 ||
    input.city.trim().length > 120 || input.neighborhood.trim().length > 160) {
    return 'Selecciona una ubicación válida y una zona de hasta 160 caracteres.';
  }
  if (!['SALE', 'RENT', 'ADMINISTRATION'].includes(input.operation_type) ||
    !['HOUSE', 'APARTMENT', 'COMMERCIAL'].includes(input.property_type)) {
    return 'Selecciona una operación y un tipo de inmueble válidos.';
  }
  const amounts = [input.price, input.administration_fee, input.lot_area, input.built_area];
  if (amounts.some(value => !Number.isFinite(value) || value < 0 || value > 1e13 ||
      Math.abs(value * 100 - Math.round(value * 100)) > 0.001) ||
    input.price <= 0 || input.lot_area <= 0 || input.built_area <= 0 ||
    input.lot_area > 1e8 || input.built_area > 1e8) {
    return 'Ingresa precios y áreas válidos, con un máximo de dos decimales y mayores que cero.';
  }
  if (!Number.isInteger(input.bedrooms) || input.bedrooms < 0 || input.bedrooms > 500 ||
    !Number.isInteger(input.bathrooms * 2) || input.bathrooms < 0 || input.bathrooms > 500 ||
    !Number.isInteger(input.parking_spaces) || input.parking_spaces < 0 || input.parking_spaces > 5000) {
    return 'Ingresa habitaciones y estacionamientos enteros; los baños admiten medios baños.';
  }
  if (input.construction_year !== null && (!Number.isInteger(input.construction_year) ||
    input.construction_year < 1800 || input.construction_year > year)) {
    return 'Ingresa un año de construcción válido o deja el campo vacío.';
  }
  if (!input.contact_consent) return 'Autoriza el contacto para enviar la solicitud.';
  return null;
}

export function consignmentErrorMessage(error: { message?: string; code?: string } | null | undefined): string {
  switch (error?.message) {
    case 'intake_rate_limited': return 'Se alcanzó el límite de solicitudes. Intenta más tarde o contacta directamente a la inmobiliaria.';
    case 'intake_unavailable': return 'La recepción de consignaciones no está disponible. Contacta directamente a la inmobiliaria.';
    case 'contact_consent_required': return 'Autoriza el contacto para enviar la solicitud.';
    case 'consignment_request_conflict': return 'Los datos cambiaron durante el envío. Revisa la solicitud e intenta nuevamente.';
    case 'consignment_permission_denied': return 'No tienes los permisos necesarios para revisar esta consignación.';
    case 'consignment_already_reviewed': return 'Esta consignación ya fue revisada. Actualiza la bandeja.';
    case 'invalid_consignment': return 'Revisa los datos de la propiedad y del contacto antes de enviar.';
    default: return 'No se pudo confirmar la operación. Conservamos los datos del formulario; intenta nuevamente.';
  }
}
