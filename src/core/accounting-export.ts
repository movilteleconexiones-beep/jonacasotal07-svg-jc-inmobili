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
  return rows.reduce<{expected:number;paid:number;outstanding:number}>((result,row) => {
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

/** Single-choice export contract shared by KPI cards, module chips, and Excel output. */
export const MONTHLY_MODULE_NAMES = [
  'Propiedades','Clientes','Propietarios','CRM','Negocios','Comisiones','Contratos','Cánones','Liquidaciones',
] as const;
export type MonthlyModuleName = (typeof MONTHLY_MODULE_NAMES)[number];

export const MONTHLY_METRICS = {
  EXPECTED_RENT: { label:'Canon esperado', source:'Cánones' },
  RECORDED_RENT: { label:'Pago registrado', source:'Cánones' },
  PENDING_RENT: { label:'Saldo por recaudar (períodos registrados)', source:'Cánones' },
  OWNER_NET: { label:'Neto registrado para propietarios', source:'Liquidaciones' },
  OWNER_COMMISSION: { label:'Comisiones de administración en liquidaciones', source:'Liquidaciones' },
  OWNER_OTHER: { label:'Otras deducciones de propietarios', source:'Liquidaciones' },
  WON_DEALS: { label:'Negocios ganados', source:'Negocios' },
} as const;
export type MonthlyMetricKey = keyof typeof MONTHLY_METRICS;
export type MonthlyReportSelection =
  | { kind:'module'; name:MonthlyModuleName }
  | { kind:'metric'; key:MonthlyMetricKey };

export interface AccountingReportSheet {
  name: string;
  columns: string[];
  rows: WorkbookDataRow[];
}

export interface IndividualWorkbookContent {
  title:string;
  sheetName:string;
  columns:string[];
  rows:WorkbookDataRow[];
  total:number | null;
}

/** Only the selected module or KPI is included. Never include unrelated sheets or indicators. */
export function selectedWorkbookContent(
  selection:MonthlyReportSelection,
  available:AccountingReportSheet[],
):IndividualWorkbookContent {
  const sourceName=selection.kind==='module' ? selection.name : MONTHLY_METRICS[selection.key].source;
  const sheet=available.find(candidate=>candidate.name===sourceName);
  if (!sheet) throw new Error('No tienes autorización para exportar esta sección o sus datos no se cargaron.');
  if (selection.kind==='module') return {
    title:sourceName, sheetName:sourceName, columns:[...sheet.columns], rows:[...sheet.rows], total:null,
  };
  const key=selection.key;
  const isRent=key==='EXPECTED_RENT'||key==='RECORDED_RENT'||key==='PENDING_RENT';
  const isDeal=key==='WON_DEALS';
  const relevant=sheet.rows.filter(row=>isRent ? row.status!=='CANCELLED' : isDeal ? row.stage==='WON' : true);
  const valueFromRow=(row:WorkbookDataRow):number=>{
    if(isDeal)return 1;
    if(isRent){
      const due=Number(row.expected_amount),paid=Number(row.paid_amount);
      if(!Number.isFinite(due)||due<0||!Number.isFinite(paid)||paid<0)
        throw new Error('Un período tiene valores inválidos; revisa los cánones antes de exportar.');
      if(key==='EXPECTED_RENT')return due;
      if(key==='RECORDED_RENT')return paid;
      return Math.max(0,due-paid);
    }
    const field=key==='OWNER_NET'?'net_amount':key==='OWNER_COMMISSION'?'commission_amount':'other_deductions';
    const amount=Number(row[field]);
    if(!Number.isFinite(amount)||amount<0)
      throw new Error('Una liquidación tiene valores inválidos; revisa los importes antes de exportar.');
    return amount;
  };
  const columns=isRent?['lease_id','period_month','status','valor']:
    isDeal?['created_at','operation_type','stage','valor']:
    ['lease_id','owner_id','period_month','status','valor'];
  const rows=relevant.map(row=>({
    ...Object.fromEntries(columns.filter(col=>col!=='valor').map(col=>[col,row[col]])),
    valor:valueFromRow(row),
  }));
  return {
    title:MONTHLY_METRICS[key].label,
    sheetName:MONTHLY_METRICS[key].label.slice(0,31),
    columns,
    rows,
    total:rows.reduce((sum,row)=>sum+Number(row.valor),0),
  };
}
