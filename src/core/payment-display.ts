/**
 * Pure presentation of payment status. Never equate a Sandbox approval to a
 * real commercial activation, even when the test license was applied.
 */
export interface PaymentDisplayStatus {
  environment: string;
  status: string;
  fulfillment_status: string;
}

export function paymentDisplayLabel(order: PaymentDisplayStatus): string {
  const sandbox = order.environment === 'sandbox';
  if (sandbox) {
    if (order.status === 'APPROVED') {
      return order.fulfillment_status === 'APPLIED'
        ? 'Simulación aprobada · acceso de prueba, no licencia comercial'
        : 'Simulación aprobada · sin licencia comercial';
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
