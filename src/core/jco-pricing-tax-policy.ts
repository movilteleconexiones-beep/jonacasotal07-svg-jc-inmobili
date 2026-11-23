/**
 * JCO prices in COP: BASIC/PRO prices were revised explicitly by the owner on
 * 22-Nov-2026: BASIC 149900 and PRO 349900 COP monthly.
 * Production plan prices are
 * stored in Supabase and MUST match the approved checkout catalogue before
 * Wompi LIVE. Other annual/Enterprise/Lifetime legacy reference amounts
 * are NOT an active consumer checkout offer. No constant authorizes payment.
 *
 * The SaaS seller's updated 20-Nov-2026 RUT shows responsibility 49:
 * NOT RESPONSIBLE FOR IVA. No IVA may be silently added or described as
 * collected in the 2026 checkout. The obligation to issue an invoice is
 * a separate DIAN assessment; neither status authorizes tax exemption.
 */
export const JCO_SELLER_RUT_2026 = Object.freeze({
  responsibilityCode:'49',
  vatRegime:'NON_RESPONSIBLE',
  reviewedRutDate:'2026-11-20',
} as const);
export const JCO_APPROVED_PRICES_COP = Object.freeze({
  BASIC: 149900,
  PRO: 349900,
  ENTERPRISE: 389900,
  BASIC_ANNUAL: 1039000,
  PRO_ANNUAL: 1949000,
  ENTERPRISE_ANNUAL: 3899000,
  LIFETIME: 6490000,
} as const);

export type JcoPlanCode = keyof typeof JCO_APPROVED_PRICES_COP;

export type TaxDecision =
  | { kind: '2026_final_price'; amountCop: number; sellerVatRegime: 'NON_RESPONSIBLE'; vatChargedCop: 0 }
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
    return { kind: '2026_final_price', amountCop, sellerVatRegime: JCO_SELLER_RUT_2026.vatRegime, vatChargedCop: 0 };
  }
  return { kind: 'tax_configuration_required', baseAmountCop: amountCop, effectiveFrom: '2027-01-01' };
}
