/** Parse form amounts in integer cents, avoiding binary floating-point checks. */
export function parseMoneyInput(value: unknown, allowZero = false): number {
  if (typeof value !== 'string') return NaN;
  const match = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return NaN;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && (allowZero ? cents >= 0 : cents > 0)
    ? cents / 100 : NaN;
}

/** Pure amount calculations used by client and owner summaries. */
export function financialAmount(value: number | string | null | undefined): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) && result >= 0 && Number.isSafeInteger(Math.round(result * 100)) ? result : NaN;
}

export function rentalBalance(expected: number, paid: number): number {
  return Math.max(0, financialAmount(expected) - financialAmount(paid));
}

export interface OwnerDeductionAmounts {
  gross_income: number;
  commission_amount: number;
  tax_amount: number;
  other_deductions: number;
}

export function ownerNetFromDeductions(statement: OwnerDeductionAmounts): number {
  return financialAmount(statement.gross_income) - financialAmount(statement.commission_amount) -
    financialAmount(statement.tax_amount) - financialAmount(statement.other_deductions);
}
