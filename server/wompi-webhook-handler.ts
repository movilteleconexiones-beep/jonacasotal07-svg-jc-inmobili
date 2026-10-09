import { getVerifiedWompiTransaction, verifyWompiEvent } from './wompi-event-verification.js';
import { canTransitionPayment, matchesPaymentOrder } from '../src/core/payment-state-machine.js';

export interface StoredPaymentOrder {
  id: string;
  reference: string;
  amountInCents: number;
  currency: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';
  providerTransactionId?: string | null;
  environment: 'sandbox' | 'production';
}

export interface PaymentStore {
  /** Must execute atomically under a DB row lock and unique event constraint. */
  processVerifiedEvent(input: {
    reference: string;
    transactionId: string;
    amountInCents: number;
    currency: string;
    status: StoredPaymentOrder['status'];
    environment: StoredPaymentOrder['environment'];
  }): Promise<'processed' | 'duplicate' | 'not_found' | 'mismatch' | 'conflict'>;
}

/**
 * Server-only webhook logic. Requires a transactional PaymentStore implementation.
 * Do not mount an endpoint before the database implementation is ready.
 */
export async function handleWompiWebhook(
  body: unknown,
  eventsSecret: string,
  environment: 'sandbox' | 'production',
  store: PaymentStore,
  checksumHeader?: string,
): Promise<{ statusCode: number; result: string }> {
  const wompiEnvironment = environment === 'sandbox' ? 'test' : 'prod';
  if (!verifyWompiEvent(body, eventsSecret, wompiEnvironment, checksumHeader)) {
    return { statusCode: 401, result: 'invalid_signature' };
  }
  const tx = getVerifiedWompiTransaction(body);
  if (!tx || tx.currency !== 'COP' || tx.amountInCents <= 0) {
    return { statusCode: 400, result: 'invalid_transaction' };
  }
  // PENDING is not a successful payment and must not activate subscriptions.
  if (tx.status === 'PENDING') return { statusCode: 200, result: 'pending' };
  const result = await store.processVerifiedEvent({
    reference: tx.reference,
    transactionId: tx.id,
    amountInCents: tx.amountInCents,
    currency: tx.currency,
    status: tx.status as StoredPaymentOrder['status'],
    environment,
  });
  return {
    statusCode: result === 'processed' || result === 'duplicate' ? 200
      : result === 'not_found' ? 404 : 409,
    result,
  };
}

/** Shared predicates for the atomic database implementation. */
export function isMatchingPendingOrder(
  order: StoredPaymentOrder,
  input: { reference: string; transactionId: string; amountInCents: number; currency: string; status: StoredPaymentOrder['status']; environment: StoredPaymentOrder['environment'] },
): boolean {
  return order.environment === input.environment
    && canTransitionPayment(order.status, input.status)
    && matchesPaymentOrder(order, {
      reference: input.reference,
      providerTransactionId: input.transactionId,
      amountInCents: input.amountInCents,
      currency: input.currency,
    });
}
