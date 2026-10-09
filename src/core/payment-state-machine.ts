/**
 * Pure JCO payment state machine. This is not webhook authentication.
 * Only a trusted server can call the database transition after verifying Wompi.
 */
export type OrderStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';

const allowedTransitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ['APPROVED', 'DECLINED', 'VOIDED', 'ERROR'],
  APPROVED: [],
  DECLINED: [],
  VOIDED: [],
  ERROR: [],
};

export function canTransitionPayment(current: OrderStatus, next: OrderStatus): boolean {
  return allowedTransitions[current]?.includes(next) ?? false;
}

export function shouldGrantLicense(status: OrderStatus, signatureVerified: boolean, orderMatches: boolean): boolean {
  return status === 'APPROVED' && signatureVerified && orderMatches;
}

/** Prevent a payment for one tenant from being attributed to another. */
export function matchesPaymentOrder(
  order: { reference: string; amountInCents: number; currency: string; providerTransactionId?: string | null },
  event: { reference: string; amountInCents: number; currency: string; providerTransactionId: string },
): boolean {
  return order.reference === event.reference
    && order.amountInCents === event.amountInCents
    && order.currency === event.currency
    && (!order.providerTransactionId || order.providerTransactionId === event.providerTransactionId);
}
