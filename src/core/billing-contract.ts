/**
 * JCO payment contract. Pure validation helpers, safe to use in the UI or server.
 * IMPORTANT: never treat these functions as proof of payment.
 * Only a trusted server may validate Wompi signatures and activate subscriptions.
 */
export const BILLING_MODES = ['SAAS_MONTHLY', 'SAAS_ANNUAL', 'LIFETIME'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const PAYMENT_STATUSES = ['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface CheckoutQuote {
  organizationId: string;
  planCode: string;
  billingMode: BillingMode;
  amountInCents: number;
  currency: 'COP';
  reference: string;
}

export interface PaymentNotification {
  provider: 'WOMPI';
  providerTransactionId: string;
  reference: string;
  status: PaymentStatus;
  amountInCents: number;
  currency: 'COP';
}

export function isBillingMode(value: unknown): value is BillingMode {
  return typeof value === 'string' && (BILLING_MODES as readonly string[]).includes(value);
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

export function isValidCheckoutQuote(value: unknown): value is CheckoutQuote {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.organizationId === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(v.organizationId)
    && typeof v.planCode === 'string' && /^[A-Z0-9_-]{2,40}$/.test(v.planCode)
    && isBillingMode(v.billingMode)
    && typeof v.amountInCents === 'number' && Number.isSafeInteger(v.amountInCents) && v.amountInCents > 0
    && v.currency === 'COP'
    && typeof v.reference === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(v.reference);
}

export function isValidPaymentNotification(value: unknown): value is PaymentNotification {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.provider === 'WOMPI'
    && typeof v.providerTransactionId === 'string' && v.providerTransactionId.length > 0
    && typeof v.reference === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(v.reference)
    && isPaymentStatus(v.status)
    && typeof v.amountInCents === 'number' && Number.isSafeInteger(v.amountInCents) && v.amountInCents > 0
    && v.currency === 'COP';
}
