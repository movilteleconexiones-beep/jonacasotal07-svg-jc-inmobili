import { financialAmount } from './rent-owner-money';

export const OWNER_DEDUCTION_CATEGORIES = [
  'WATER','ELECTRICITY','GAS','WASTE','BUILDING_FEE','MAINTENANCE',
  'REPAIRS','INSURANCE','TAX','COMMISSION','OTHER',
] as const;
export type DeductionCategory = (typeof OWNER_DEDUCTION_CATEGORIES)[number];
export type ChargeResponsibility = 'OWNER' | 'TENANT' | 'AGENCY';
export type DeductionStatus = 'DRAFT' | 'APPROVED' | 'VOIDED';

export interface DeductionLine {
  category: DeductionCategory;
  responsible_party: ChargeResponsibility;
  status: DeductionStatus;
  amount: number | string;
}

export interface OwnerStatementSummary {
  gross_income: number | string;
  commission_amount: number | string;
  tax_amount: number | string;
  other_deductions: number | string;
  net_amount: number | string;
}

function cents(value: number | string): number {
  const n = financialAmount(value);
  const converted = Math.round(n * 100);
  if (!Number.isSafeInteger(converted) || converted < 0) {
    throw new Error('Valor monetario inválido para una liquidación.');
  }
  return converted;
}

/**
 * Only APPROVED + OWNER rows can affect the owner's deductions.
 * Commission and tax already exist in dedicated summary columns, so
 * they must never be counted twice in "other deductions".
 * This does not execute a transfer, update a statement, or infer due rent.
 */
export function reconcileOwnerDeductionLines(
  summary: OwnerStatementSummary,
  lines: DeductionLine[],
) {
  const recordedCommission = cents(summary.commission_amount);
  const recordedTax = cents(summary.tax_amount);
  const recordedOther = cents(summary.other_deductions);
  const gross = cents(summary.gross_income);
  const storedNet = cents(summary.net_amount);
  const detailed = { commission: 0, tax: 0, other: 0, tenant: 0, agency: 0 };
  let pending = 0;
  let approved = 0;
  let voided = 0;
  for (const line of lines) {
    const value = cents(line.amount);
    if (value === 0 || !OWNER_DEDUCTION_CATEGORIES.includes(line.category)) {
      throw new Error('Concepto o importe inválido en una deducción.');
    }
    if (line.status === 'VOIDED') { voided++; continue; }
    if (line.status === 'DRAFT') { pending++; continue; }
    if (line.status !== 'APPROVED') throw new Error('Estado de deducción inválido.');
    approved++;
    if (line.responsible_party === 'TENANT') {
      detailed.tenant += value;
    } else if (line.responsible_party === 'AGENCY') {
      detailed.agency += value;
    } else if (line.responsible_party === 'OWNER') {
      if (line.category === 'COMMISSION') detailed.commission += value;
      else if (line.category === 'TAX') detailed.tax += value;
      else detailed.other += value;
    } else throw new Error('Responsable de deducción inválido.');
  }

  const expectedNet = gross - recordedCommission - recordedTax - recordedOther;
  const allMatches = expectedNet === storedNet &&
    detailed.commission === recordedCommission &&
    detailed.tax === recordedTax &&
    detailed.other === recordedOther;

  const status = lines.length === 0 ? 'NO_DETAILS' :
    pending > 0 ? 'PENDING' :
      !allMatches ? 'MISMATCH' : 'RECONCILED';

  return {
    status,
    pending,
    approved,
    voided,
    gross: gross / 100,
    recordedNet: storedNet / 100,
    expectedNet: expectedNet / 100,
    recorded: { commission: recordedCommission / 100, tax: recordedTax / 100, other: recordedOther / 100 },
    detailed: Object.fromEntries(Object.entries(detailed).map(([key, value]) => [key, value / 100])) as typeof detailed,
    bankTransferConfirmed: false as const,
  };
}
