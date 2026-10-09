/**
 * JCO commercial prices, in COP. These are approved customer totals during
 * the 2026 launch, with applicable VAT included. From 2027 the approved
 * amount is the base price and tax may be added ONLY after explicit,
 * jurisdiction-specific tax configuration and contractual review.
 * Never use these constants as evidence of payment or license entitlement.
 */
export const JCO_APPROVED_PRICES_COP = Object.freeze({
  BASIC: 104900,
  PRO: 194900,
  ENTERPRISE: 389900,
  BASIC_ANNUAL: 1039000,
  PRO_ANNUAL: 1949000,
  ENTERPRISE_ANNUAL: 3899000,
  LIFETIME: 6490000,
} as const);

export type JcoPlanCode = keyof typeof JCO_APPROVED_PRICES_COP;

export type TaxDecision =
  | { kind: '2026_final_price'; amountCop: number; taxIncludedWhenApplicable: true }
  | { kind: 'tax_configuration_required'; baseAmountCop: number; effectiveFrom: '2027-01-01' };

/**
 * The date is a Colombia-local calendar date, not a UTC timestamp.
 * Fail closed: 2027+ checkout must not silently add an assumed 19% VAT.
 */
export function getJcoTaxDecision(plan: JcoPlanCode, colombiaDate: string): TaxDecision {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(colombiaDate)
    || Number.isNaN(Date.parse(colombiaDate))
    || new Date(colombiaDate).toISOString().slice(0, 10) !== colombiaDate) {
    throw new Error('Expected valid Colombia-local YYYY-MM-DD date');
  }
  const amountCop = JCO_APPROVED_PRICES_COP[plan];
  if (!amountCop) throw new Error('Unknown JCO plan');
  if (colombiaDate < '2027-01-01') {
    return { kind: '2026_final_price', amountCop, taxIncludedWhenApplicable: true };
  }
  return { kind: 'tax_configuration_required', baseAmountCop: amountCop, effectiveFrom: '2027-01-01' };
}
