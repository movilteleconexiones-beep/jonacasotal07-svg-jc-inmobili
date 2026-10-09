import { randomBytes } from 'node:crypto';
import { quoteJcoSandboxOrder } from './wompi-sandbox-order-quote.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CreateSandboxOrderInput {
  organizationId: string;
  planCode: string;
  colombiaDate: string;
}

export interface TrustedSandboxOrderDraft {
  organizationId: string;
  planCode: string;
  billingMode: 'SAAS_MONTHLY' | 'SAAS_ANNUAL' | 'LIFETIME';
  amountInCents: number;
  currency: 'COP';
  environment: 'sandbox';
  reference: string;
}

/**
 * Server-only draft for a pending order.
 * Caller MUST independently authenticate the user, verify ACTIVE tenant
 * membership and billing permission, check plan price against the database,
 * and atomically insert via a trusted backend before exposing the reference.
 * This does not write to Supabase or start checkout.
 */
export function buildSandboxOrderDraft(input: CreateSandboxOrderInput): TrustedSandboxOrderDraft {
  if (!UUID.test(input.organizationId)) throw new Error('Invalid organization ID');
  const quote = quoteJcoSandboxOrder(input.planCode, input.colombiaDate);
  return {
    organizationId: input.organizationId,
    ...quote,
    reference: 'JCO_' + randomBytes(16).toString('hex'),
  };
}
