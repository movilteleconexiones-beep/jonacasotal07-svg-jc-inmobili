import { createHash } from 'node:crypto';
import type { PaymentStore } from './wompi-webhook-handler.js';

type PaymentResult = 'processed' | 'duplicate' | 'not_found' | 'mismatch' | 'conflict';
type RpcResponse = { data: string | null; error: { message: string } | null };
export interface PaymentRpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResponse>;
}

/**
 * Trusted server only. The caller must first authenticate the Wompi event.
 * This adapter never holds a service key and never grants subscriptions.
 */
export function createSupabasePaymentStore(client: PaymentRpcClient): PaymentStore {
  return {
    async processVerifiedEvent(input): Promise<PaymentResult> {
      // Deterministic identity: repeated delivery of identical transaction state
      // resolves to one event, regardless of HTTP retry timing.
      const normalized = JSON.stringify([
        'WOMPI', input.environment, input.reference, input.transactionId,
        input.amountInCents, input.currency, input.status,
      ]);
      const fingerprint = createHash('sha256').update(normalized).digest('hex');
      const { data, error } = await client.rpc('process_verified_payment_event', {
        p_reference: input.reference,
        p_transaction_id: input.transactionId,
        p_amount_in_cents: input.amountInCents,
        p_currency: input.currency,
        p_status: input.status,
        p_environment: input.environment,
        p_event_id: fingerprint,
        p_payload_sha256: fingerprint,
      });
      if (error) throw new Error('Payment processing failed');
      if (data === 'processed' || data === 'duplicate' || data === 'not_found'
        || data === 'mismatch' || data === 'conflict') return data;
      throw new Error('Unexpected payment processing result');
    },
  };
}
