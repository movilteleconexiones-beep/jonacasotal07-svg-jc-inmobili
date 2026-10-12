/** Pure amount calculations used by read-only client and owner summaries. */
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
