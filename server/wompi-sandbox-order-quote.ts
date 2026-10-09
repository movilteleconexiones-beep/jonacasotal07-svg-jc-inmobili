import { JCO_APPROVED_PRICES_COP, getJcoTaxDecision, type JcoPlanCode } from '../src/core/jco-pricing-tax-policy.js';
import type { BillingMode } from '../src/core/billing-contract.js';

export interface TrustedOrderQuote {
  planCode: JcoPlanCode;
  billingMode: BillingMode;
  amountInCents: number;
  currency: 'COP';
  environment: 'sandbox';
}

const CYCLES: Record<JcoPlanCode, BillingMode> = {
  BASIC: 'SAAS_MONTHLY', PRO: 'SAAS_MONTHLY', ENTERPRISE: 'SAAS_MONTHLY',
  BASIC_ANNUAL: 'SAAS_ANNUAL', PRO_ANNUAL: 'SAAS_ANNUAL',
  ENTERPRISE_ANNUAL: 'SAAS_ANNUAL', LIFETIME: 'LIFETIME',
};

/**
 * Server-only quotation. The client cannot supply price or environment.
 * LIFETIME requires manual legal approval and is deliberately not quotable.
 * Tax configuration must be implemented before quoting any 2027+ checkout.
 * This function does not insert an order or authorize a payment.
 */
export function quoteJcoSandboxOrder(planCode: string, colombiaDate: string): TrustedOrderQuote {
  if (!Object.prototype.hasOwnProperty.call(JCO_APPROVED_PRICES_COP, planCode)) {
    throw new Error('Unsupported JCO plan');
  }
  const code = planCode as JcoPlanCode;
  if (code === 'LIFETIME') throw new Error('Lifetime plan requires manual approval');
  const tax = getJcoTaxDecision(code, colombiaDate);
  if (tax.kind !== '2026_final_price') throw new Error('Tax configuration required before checkout');
  return {
    planCode: code, billingMode: CYCLES[code],
    amountInCents: tax.amountCop * 100, currency: 'COP', environment: 'sandbox',
  };
}
