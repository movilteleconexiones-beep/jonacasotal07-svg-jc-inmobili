/**
 * Advisory comparison only. The signed lease and its effective future addenda
 * are the reference; registered charges, receipts and historic settlements are
 * immutable from this helper.
 *
 * This is NOT a debt calculator: only previously recorded rent periods are read.
 */
export interface CanonPeriod {
  lease_id: string;
  period_month: string;
  expected_amount: number | string;
  status: string;
}
export interface CanonAmendment {
  lease_id: string;
  effective_month: string;
  new_monthly_rent: number | string;
}
export interface CanonDiscrepancy {
  period: string;
  referenceCanon: number;
  recordedCanon: number;
  difference: number;
  direction: 'superior' | 'inferior';
  reference: 'CONTRATO' | 'OTROSI';
}

function monthKey(value: string): string | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(value);
  return match ? match[1] + '-' + match[2] : null;
}

function positiveCents(value: number | string | null | undefined): number | null {
  if (value == null || String(value).trim() === '') return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0 || numberValue > 999999999999.99) return null;
  const cents = Math.round(numberValue * 100);
  return Math.abs(numberValue * 100 - cents) < 0.0001 ? cents : null;
}

/** A mismatch requires an actual billing period and a complete amendment list. */
export function rentPeriodCanonDiscrepancy(
  originalCanon: number | string | null | undefined,
  period: CanonPeriod,
  amendments: readonly CanonAmendment[],
): CanonDiscrepancy | null {
  const month = monthKey(period.period_month);
  if (!month || period.status === 'CANCELLED') return null;
  const chargedCents = positiveCents(period.expected_amount);
  const originalCents = positiveCents(originalCanon);
  if (chargedCents == null || originalCents == null) return null;

  let effectiveMonth: string | null = null;
  let referenceCents = originalCents;
  for (const amendment of amendments) {
    if (amendment.lease_id !== period.lease_id) continue;
    const start = monthKey(amendment.effective_month);
    if (start == null || start > month || (effectiveMonth !== null && start <= effectiveMonth)) continue;
    const cents = positiveCents(amendment.new_monthly_rent);
    if (cents == null) return null; // Untrustworthy reference: fail closed.
    effectiveMonth = start;
    referenceCents = cents;
  }
  if (chargedCents === referenceCents) return null;
  return {
    period: month,
    referenceCanon: referenceCents / 100,
    recordedCanon: chargedCents / 100,
    difference: Math.abs(chargedCents - referenceCents) / 100,
    direction: chargedCents > referenceCents ? 'superior' : 'inferior',
    reference: effectiveMonth ? 'OTROSI' : 'CONTRATO',
  };
}
