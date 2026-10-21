/**
 * Pure presentation of payment status. Never equate a Sandbox approval to a
 * real commercial activation, even when the test license was applied.
 */
export interface PaymentDisplayStatus {
  environment: string;
  status: string;
  fulfillment_status: string;
  review_reason?: string | null;
}

export function paymentDisplayLabel(order: PaymentDisplayStatus): string {
  const sandbox = order.environment === 'sandbox';
  if (sandbox) {
    if (order.status === 'APPROVED') {
      if (order.fulfillment_status === 'APPLIED')
        return 'Simulación aprobada · acceso de prueba, no licencia comercial';
      if (order.fulfillment_status === 'REVIEW_REQUIRED')
        return 'Simulación aprobada · requiere revisión, sin licencia comercial';
      return 'Simulación aprobada · sin licencia comercial';
    }
    if (order.status === 'PENDING') return 'Simulación pendiente de confirmación';
    return 'Simulación no aprobada';
  }
  if (order.environment !== 'production') return 'Entorno de pago desconocido · verificar';
  if (order.status === 'APPROVED') {
    return order.fulfillment_status === 'APPLIED'
      ? 'Pago real confirmado · plan activado'
      : 'Pago real aprobado · pendiente de revisión';
  }
  if (order.status === 'PENDING') return 'Pago real pendiente de confirmación';
  return 'Pago real no aprobado';
}

/**
 * This never decides entitlement. It only explains a *verified* order already
 * requiring a privileged review; unknown reasons fail closed to generic text.
 */
export function paymentReviewNotice(order: PaymentDisplayStatus): string | null {
  if (order.status !== 'APPROVED' || order.fulfillment_status !== 'REVIEW_REQUIRED'
      || !['sandbox', 'production'].includes(order.environment)) return null;
  switch (order.review_reason) {
    case 'contract_review':
      return 'La orden requiere revisar la compatibilidad con el plan o contrato vigente. No se aplicará automáticamente.';
    case 'license_review':
      return 'Existe una licencia previa que debe revisarse antes de modificar el acceso.';
    case 'manual_approval':
      return 'La activación requiere autorización del superadministrador.';
    case 'expired_order':
      return 'La orden venció antes de aplicarse. Solicita una revisión administrativa.';
    case 'organization_inactive':
      return 'El estado de la inmobiliaria impide aplicar esta orden.';
    case 'sandbox_isolation':
      return 'La operación de pruebas no puede activar una licencia comercial.';
    case 'production_disabled':
      return 'Los cobros comerciales están deshabilitados y la orden no puede aplicarse.';
    default:
      return 'La orden permanece pendiente de revisión administrativa. No se ha activado una nueva licencia.';
  }
}
