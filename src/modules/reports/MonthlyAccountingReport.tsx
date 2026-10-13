import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { supabase } from '../../lib/supabase';
import { effectiveCommissionRows } from '../../core/effective-commissions';
import { reconciliationAlerts } from '../../core/owner-reconciliation-alerts';
import {
  excelSafeCell, monthlyDateBounds, financialTotal, rentPeriodTotals,
  selectedWorkbookContent, MONTHLY_METRICS,
  type MonthlyReportSelection, type MonthlyMetricKey,
} from '../../core/accounting-export';

type DataRow = Record<string, unknown>;
interface ReportSheet { name: string; columns: string[]; rows: DataRow[]; }
const MONTHLY_SECTIONS = [
  { name:'Propiedades', table:'properties', permission:PERMISSIONS.PROPERTIES_VIEW, date:'created_at', cols:'code,title,status,operation_type,property_type,price,currency,city,created_at' },
  { name:'Clientes', table:'contacts', permission:PERMISSIONS.CLIENTS_VIEW, date:'created_at', cols:'first_name,last_name,email,phone,source,created_at' },
  { name:'Propietarios', table:'property_owners', permission:PERMISSIONS.OWNERS_VIEW, date:'created_at', cols:'first_name,last_name,document_type,document_number,created_at' },
  { name:'CRM', table:'leads', permission:PERMISSIONS.LEADS_VIEW, date:'created_at', cols:'status,contact_id,property_id,created_at' },
  { name:'Negocios', table:'deals', permission:PERMISSIONS.DEALS_VIEW, date:'created_at', cols:'stage,operation_type,asking_price,offered_price,final_price,created_at' },
  { name:'Comisiones', table:'commissions', permission:PERMISSIONS.COMMISSIONS_VIEW, date:'created_at', cols:'id,status,amount,deal_id,beneficiary_user_id,created_at' },
  { name:'Contratos', table:'leases', permission:PERMISSIONS.LEASES_VIEW, date:'start_date', cols:'contract_number,tenant_id,owner_id,property_id,monthly_rent,status,start_date,end_date' },
  { name:'Cánones', table:'rent_payments', permission:PERMISSIONS.RENT_PAYMENTS_VIEW, date:'period_month', cols:'lease_id,period_month,expected_amount,paid_amount,status,paid_at' },
  { name:'Liquidaciones', table:'owner_statements', permission:PERMISSIONS.OWNER_STATEMENTS_VIEW, date:'period_month', cols:'id,lease_id,owner_id,period_month,gross_income,commission_amount,tax_amount,other_deductions,net_amount,status' },
] as const;
const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
};
const safeFilename = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,40);

interface MonthlyAccountingReportProps {
  selection: MonthlyReportSelection | null;
  onSelect: (value: MonthlyReportSelection) => void;
}
const DISPLAYED_METRICS: MonthlyMetricKey[] = [
  'EXPECTED_RENT','RECORDED_RENT','PENDING_RENT',
  'OWNER_NET','OWNER_COMMISSION','OWNER_OTHER',
];

export function MonthlyAccountingReport({ selection, onSelect }: MonthlyAccountingReportProps) {
  const { activeMembership, can } = useAuth();
  const { branding } = useTenantBranding();
  const organizationId = activeMembership?.organization.id;
  const allowed = can(PERMISSIONS.REPORTS_VIEW);
  const [month,setMonth] = useState(currentMonth);
  const [sheets,setSheets] = useState<ReportSheet[]>([]);
  const [staleCount,setStaleCount] = useState(0);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [revision,setRevision] = useState(0);
  const [exporting,setExporting] = useState(false);
  const [loadedFor,setLoadedFor] = useState('');
  const permitted = MONTHLY_SECTIONS.filter(item => can(item.permission));
  const permissionSignature = permitted.map(item=>item.name).join('|');
  const loadKey = [organizationId,month,permissionSignature].join(':');
  const money = useMemo(() => (n:number) => new Intl.NumberFormat(branding.locale||'es-CO',
    {style:'currency',currency:branding.currency||'COP'}).format(n),[branding.locale,branding.currency]);

  useEffect(() => {
    let cancelled = false;
    setSheets([]);
    setStaleCount(0);
    setLoadedFor('');
    setError('');
    if (!allowed || !organizationId) { setLoading(false); return () => {cancelled=true;}; }
    setLoading(true);
    void (async() => {
      try {
        const {start,end} = monthlyDateBounds(month);
        const results: ReportSheet[] = [];
        // Report approved owner deductions by their actual ledger state, not stale statement totals.
        // The displayed deduction figure is a live breakdown; owner statement net stays as last reconciled.
        const deductionQuery=can(PERMISSIONS.OWNER_STATEMENTS_VIEW)
          ? await supabase.from('owner_statement_deductions')
              .select('id,statement_id,amount,responsible_party,status,category,charge_date',{count:'exact'})
              .eq('organization_id',organizationId)
              .gte('charge_date',start).lt('charge_date',end).limit(1000)
          : null;
        if(deductionQuery?.error)throw new Error('No se pudieron consultar las deducciones: '+deductionQuery.error.message);
        const deductionRows=deductionQuery?.data??[];
        if(deductionQuery&&(deductionQuery.count==null||deductionQuery.count>deductionRows.length))
          throw new Error('La consulta de deducciones está incompleta.');
        let rectifications: {commission_id:string;archived_from_active:boolean}[] = [];
        if (permitted.some(item=>item.name==='Comisiones')) {
          const correctionQuery=await supabase.from('commission_accounting_corrections')
            .select('commission_id,archived_from_active',{count:'exact'})
            .eq('organization_id',organizationId).limit(1000);
          if(correctionQuery.error)throw new Error('No se pudieron conciliar las comisiones rectificadas: '+correctionQuery.error.message);
          rectifications=correctionQuery.data??[];
          if(correctionQuery.count==null||correctionQuery.count>rectifications.length)
            throw new Error('Existen más rectificaciones que las consultadas: no se mostrarán cifras incompletas.');
        }
        for (const section of permitted) {
          const columns = section.cols.split(',');
          const tableName: string = section.table;
          const selectFields: string = section.cols;
          const dateColumn: string = section.date;
          // A hard result cap and exact count prevent exporting a silently truncated workbook.
          const query = await supabase.from(tableName)
            .select(selectFields,{count:'exact'})
            .eq('organization_id', organizationId)
            .gte(dateColumn,start).lt(dateColumn,end)
            .order(dateColumn,{ascending:true}).limit(1000);
          if (cancelled) return;
          if (query.error) throw new Error('No fue posible consultar '+section.name+': '+query.error.message);
          const rows = (query.data ?? []) as unknown as DataRow[];
          if (query.count == null || query.count > rows.length)
            throw new Error('La sección '+section.name+' tiene más de 1000 registros o una consulta parcial. No se exportarán cifras incompletas.');
          const effectiveRows=section.name==='Comisiones'
            ? effectiveCommissionRows(rows as ({id:string;status:string;amount:number|null}&DataRow)[],rectifications)
            : rows;
          results.push({name:section.name,columns,rows:effectiveRows});
        }
        if (deductionQuery) results.push({
          name:'Deducciones',
          columns:['id','statement_id','amount','responsible_party','status','category','charge_date'],
          rows:deductionRows.filter(item=>item.status==='APPROVED'&&item.responsible_party==='OWNER'
            &&item.category!=='TAX'&&item.category!=='COMMISSION'),
        });
                const statementRows=results.find(section=>section.name==='Liquidaciones')?.rows??[];
        const stale=reconciliationAlerts(
          statementRows.map(row=>({id:String(row.id),status:String(row.status),other_deductions:Number(row.other_deductions??0)})),
          deductionRows.map(row=>({statement_id:row.statement_id,status:row.status,responsible_party:row.responsible_party,category:row.category,amount:row.amount}))
        );
        if (!cancelled) { setSheets(results);setStaleCount(stale.length);setLoadedFor(loadKey); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'No fue posible elaborar el informe.');
      } finally {if (!cancelled) setLoading(false);}
    })();
    return ()=>{cancelled=true;};
  // permitted is intentionally derived from per-render permissions, but the stable signature
  // below avoids a network loop when the membership object reference changes.
  },[allowed,organizationId,month,revision,permissionSignature]);

  if (!allowed) return null;
  const find = (name:string) => sheets.find(s=>s.name===name)?.rows ?? [];
  const rent = rentPeriodTotals(find('Cánones'));
  const billed = rent.expected;
  const paid = rent.paid;
  const deductionRows=find('Deducciones');
  const ownerStatements=find('Liquidaciones');
  const deductedByStatement=new Map<string,number>();
  for(const entry of deductionRows) {
    const id=String(entry.statement_id);
    deductedByStatement.set(id,(deductedByStatement.get(id)??0)+Number(entry.amount??0));
  }
  const ownerNet=ownerStatements.reduce((sum,entry)=>{
    const saved=Number(entry.net_amount??0);
    if(entry.status!=='DRAFT'||!sheets.some(section=>section.name==='Deducciones'))return sum+saved;
    const approved=deductedByStatement.get(String(entry.id))??0;
    const alreadyIncluded=Number(entry.other_deductions??0);
    return sum+saved-(approved-alreadyIncluded);
  },0);

  const ownerCommission = financialTotal(find('Liquidaciones'),'commission_amount');
  const ownerOther = sheets.some(item=>item.name==='Deducciones')
    ? financialTotal(find('Deducciones'),'amount')
    : financialTotal(find('Liquidaciones'),'other_deductions');
  const canSeeRents = sheets.some(item=>item.name==='Cánones');
  const canSeeStatements = sheets.some(item=>item.name==='Liquidaciones');
  const totals = [
    ['Canon esperado',canSeeRents?billed:null],['Pago registrado',canSeeRents?paid:null],
    ['Saldo por recaudar (períodos registrados)',canSeeRents?rent.outstanding:null],
    [staleCount>0?'Neto estimado con deducciones aprobadas':'Neto registrado para propietarios',canSeeStatements?ownerNet:null],
    ['Comisiones de administración en liquidaciones',canSeeStatements?ownerCommission:null],
    ['Otras deducciones de propietarios',canSeeStatements?ownerOther:null],
  ] as const;

  const ready=!loading&&!error&&loadedFor===loadKey&&Boolean(organizationId);
  const selectedLabel=selection
    ? selection.kind==='module'?selection.name:MONTHLY_METRICS[selection.key].label
    : '';
  const selectionAvailable=selection !== null && !(staleCount>0&&selection.kind==='metric'&&selection.key==='OWNER_NET') && sheets.some(sheet=>
    sheet.name===(selection.kind==='module'?selection.name:MONTHLY_METRICS[selection.key].source));

  async function exportXlsx() {
    if (!ready || exporting || !selection || !selectionAvailable) return;
    setExporting(true);
    try {
      // The selected item is the only source of data for the workbook.
      const chosen = selectedWorkbookContent(selection,sheets);
      const XLSX = await import('xlsx');
      const book = XLSX.utils.book_new();
      const grid: (string|number)[][] = [
        ['INMOJCO · Exportación individual mensual'],
        ['Inmobiliaria',excelSafeCell(branding.companyName)],
        ['Período',month],
        ['Ítem seleccionado',excelSafeCell(chosen.title)],
        ['Documento','Informe interno para revisión contable, NO factura electrónica DIAN'],
        ['Criterio','Se incluyen solo los registros del mes y de la inmobiliaria activa para el ítem seleccionado.'],
        ['Precisión','Registros comerciales por fecha de creación; cánones y liquidaciones por período.'],
        ...(chosen.total!==null ? [['Total del indicador',chosen.total]] as (string|number)[][] : []),
        [],chosen.columns.map(column=>excelSafeCell(column)),
        ...chosen.rows.map(row=>chosen.columns.map(column=>excelSafeCell(row[column]))),
      ];
      const sheet=XLSX.utils.aoa_to_sheet(grid);
      sheet['!cols']=chosen.columns.map(col=>({wch:Math.min(45,Math.max(22,col.length+8))}));
      XLSX.utils.book_append_sheet(book,sheet,chosen.sheetName);
      XLSX.writeFile(book,
        'INMOJCO_'+safeFilename(branding.companyName)+'_'+month+'_'+safeFilename(chosen.title)+'.xlsx',
        {compression:true});
    } catch (cause) {
      setError(cause instanceof Error?'Error al generar Excel: '+cause.message:'No fue posible generar el Excel.');
    } finally { setExporting(false); }
  }

  return <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5" aria-label="Informes contables mensuales">
    {ready&&staleCount>0&&<div role="alert" className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"><strong>Liquidación pendiente de conciliar.</strong> El neto mostrado es una estimación con deducciones aprobadas; el neto oficialmente registrado sigue pendiente de conciliación. La exportación del neto estará disponible después de conciliar. Abre Liquidaciones → Deducciones y pulsa «Actualizar conciliación» antes de tomar este neto como definitivo.</div>}
        <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold">Informes mensuales y exportación contable</h2>
        <p className="text-sm text-slate-600">Conecta Propiedades, Clientes, Propietarios, CRM, Negocios, Comisiones, Contratos, Cánones y Liquidaciones. Solo módulos autorizados.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm font-semibold">Mes del informe
          <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
            className="mt-1 block rounded-lg border border-stone-300 px-3 py-2" />
        </label>
        <button type="button" onClick={()=>setRevision(v=>v+1)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm">
          <RefreshCw className="h-4 w-4"/>Actualizar
        </button>
        <button type="button" onClick={()=>void exportXlsx()}
          disabled={!ready||exporting||!selectionAvailable}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          <Download className="h-4 w-4"/>{exporting?'Generando…':'Exportar seleccionado (.xlsx)'}
        </button>
      </div>
    </div>
    <p className="text-xs text-slate-500">Selecciona un solo cuadro o módulo con un clic. Se exportará exclusivamente ese ítem y sus registros del mes, no todos los cuadros. Los indicadores superiores son totales generales; su exportación corresponde al mes elegido. El Excel puede contener datos personales: guárdalo de forma segura.</p>
    {!selection && <p className="text-sm font-medium text-slate-600">Selecciona un ítem para habilitar la exportación individual.</p>}
    {selection && <p role="status" className="text-sm font-semibold text-slate-800">
      Seleccionado: {selectedLabel} · Mes {month}. El Excel incluirá únicamente este ítem.
    </p>}
    {!ready && !error ? <p role="status">Preparando informe…</p> :
      error ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p> :
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {totals.map(([label,total],index)=>{
            const key=DISPLAYED_METRICS[index];
            const isSelected=selection?.kind==='metric' && selection.key===key;
            return <button key={key} type="button" aria-pressed={isSelected}
              onClick={()=>onSelect({kind:'metric',key})} disabled={total===null}
              title={'Seleccionar '+label+' para exportar solo ese indicador'}
              className={'rounded-xl border border-stone-200 p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 '+
                (isSelected?'bg-slate-50 ring-2 ring-slate-900':'hover:border-slate-400')}>
              <div className="text-sm text-slate-500">{label}</div>
              <div className="mt-1 text-lg font-bold">{total===null?'Sin autorización':money(total)}</div>
            </button>;
          })}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Seleccionar módulo para exportar">
          {sheets.map(sheet=>{
            const isSelected=selection?.kind==='module' && selection.name===sheet.name;
            return <button key={sheet.name} type="button" aria-pressed={isSelected}
              onClick={()=>onSelect({kind:'module',name:sheet.name as Extract<MonthlyReportSelection,{kind:'module'}>['name']})}
              title={'Exportar únicamente '+sheet.name+' de '+month}
              className={'rounded-full px-3 py-1 text-xs transition-colors '+
                (isSelected?'bg-slate-900 font-semibold text-white':'bg-stone-100 hover:bg-stone-200')}>
              {sheet.name}: {sheet.rows.length}
            </button>;
          })}
        </div>
        <p className="text-xs text-slate-500">El Excel tendrá una sola hoja, correspondiente al indicador o módulo elegido. No se exportan registros de otras inmobiliarias.</p>
      </div>}
  </section>;
}
