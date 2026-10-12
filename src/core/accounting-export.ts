export type WorkbookDataRow = Record<string, unknown>;

/** Prevents spreadsheet programs from interpreting user-controlled cells as formulas. */
export function excelSafeCell(value: unknown): string | number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const str = value == null ? '' : String(value);
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(str) ? "'" + str : str;
}

export function monthlyDateBounds(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mes de informe inválido.');
  const [year,number] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year,number,1)).toISOString().slice(0,10);
  return { start:month+'-01',end };
}
export function financialTotal(rows: WorkbookDataRow[], column: string): number {
  return rows.reduce((sum,row) => {
    const n = Number(row[column] ?? 0);
    return sum + (Number.isFinite(n) && n >= 0 ? n : 0);
  },0);
}
export function rentPeriodTotals(rows: WorkbookDataRow[]) {
  return rows.reduce((result,row) => {
    if (row.status === 'CANCELLED') return result;
    const due=Number(row.expected_amount),paid=Number(row.paid_amount);
    if (!Number.isFinite(due)||due<0||!Number.isFinite(paid)||paid<0)
      throw new Error('Un período contiene importes inválidos; el informe debe corregirse antes de exportar.');
    result.expected+=due;
    result.paid+=paid;
    result.outstanding+=Math.max(0,due-paid);
    return result;
  },{expected:0,paid:0,outstanding:0});
}
