/** Local calendar dates for form controls; UTC serialization can shift Colombian month boundaries. */
export function localDateISO(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function localMonthISO(now: Date = new Date()): string {
  return localDateISO(now).slice(0, 7);
}
