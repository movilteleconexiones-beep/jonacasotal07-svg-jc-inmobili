/** Treat the configured commission as a rate, not a currency amount. */
export function parseCommissionPercentage(value: string): number {
  const clean=value.trim();
  if (!/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/.test(clean)) return NaN;
  const rate=Number(clean);
  return Number.isFinite(rate)&&rate>=0&&rate<=100?rate:NaN;
}

/**
 * Compute COP/other currency to the cent from a percentage to two decimals.
 * Integer arithmetic avoids fractional-cent drift in high-value commissions.
 */
export function commissionValueFromRate(basis: number, percentage: number): number {
  if (!Number.isFinite(basis)||basis<0||basis>999999999999.99||
      !Number.isFinite(percentage)||percentage<0||percentage>100||
      Math.round(percentage*100)!==percentage*100) return NaN;
  const cents=BigInt(basis.toFixed(2).replace('.',''));
  const rateHundredths=BigInt(percentage.toFixed(2).replace('.',''));
  return Number((cents*rateHundredths+5000n)/10000n)/100;
}
