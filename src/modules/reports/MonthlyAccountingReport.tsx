import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { supabase } from '../../lib/supabase';
import { excelSafeCell, monthlyDateBounds, financialTotal, rentPeriodTotals } from '../../core/accounting-export';

type DataRow = Record<string, unknown>;
interface ReportSheet { name: string; columns: string[]; rows: DataRow[]; }
const MONTHLY_SECTIONS = [
  { name:'Propiedades', table:'properties', permission:PERMISSIONS.PROPERTIES_VIEW, date:'created_at', cols:'code,title,status,operation_type,property_type,price,currency,city,created_at' },
  { name:'Clientes', table:'contacts', permission:PERMISSIONS.CLIENTS_VIEW, date:'created_at', cols:'first_name,last_name,email,phone,source,created_at' },
  { name:'Propietarios', table:'property_owners', permission:PERMISSIONS.OWNERS_VIEW, date:'created_at', cols:'first_name,last_name,document_type,document_number,created_at' },
  { name:'CRM', table:'leads', permission:PERMISSIONS.LEADS_VIEW, date:'created_at', cols:'status,contact_id,property_id,created_at' },
  { name:'Negocios', table:'deals', permission:PERMISSIONS.DEALS_VIEW, date:'created_at', cols:'stage,operation_type,asking_price,offered_price,final_price,created_at' },
  { name:'Comisiones', table:'commissions', permission:PERMISSIONS.COMMISSIONS_VIEW, date:'created_at', cols:'status,amount,deal_id,beneficiary_user_id,created_at' },
  { name:'Contratos', table:'leases', permission:PERMISSIONS.LEASES_VIEW, date:'start_date', cols:'contract_number,tenant_id,owner_id,property_id,monthly_rent,status,start_date,end_date' },
  { name:'Cánones', table:'rent_payments', permission:PERMISSIONS.RENT_PAYMENTS_VIEW, date:'period_month', cols:'lease_id,period_month,expected_amount,paid_amount,status,paid_at' },
  { name:'Liquidaciones', table:'owner_statements', permission:PERMISSIONS.OWNER_STATEMENTS_VIEW, date:'period_month', cols:'lease_id,owner_id,period_month,gross_income,commission_amount,tax_amount,other_deductions,net_amount,status' },
] as const;
const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
};
const safeFilename = (text: string) => text.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'')
  .replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,40);

export function MonthlyAccountingReport() {
  const { activeMembership, can } = useAuth();
  const { branding } = useTenantBranding();
  const organizationId = activeMembership?.organization.id;
  const allowed = can(PERMISSIONS.REPORTS_VIEW);
  const [month,setMonth] = useState(currentMonth);
  const [sheets,setSheets] = useState<ReportSheet[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [revision,setRevision] = useState(0);
  const [exporting,setExporting] = useState(false);
  const permitted = MONTHLY_SECTIONS.filter(item => can(item.permission));
  const money = useMemo(() => (n:number) => new Intl.NumberFormat(branding.locale||'es-CO',
    {style:'currency',currency:branding.currency||'COP'}).format(n),[branding.locale,branding.currency]);

  useEffect(() => {
    let cancelled = false;
    setSheets([]);
    setError('');
    if (!allowed || !organizationId) { setLoading(false); return () => {cancelled=true;}; }
    setLoading(true);
    void (async() => {
      try {
        const {start,end} = monthlyDateBounds(month);
        const results: ReportSheet[] = [];
        for (const section of permitted) {
          const columns = section.cols.split(',');
          // A hard result cap and exact count prevent exporting a silently truncated workbook.
          const query = await supabase.from(section.table)
            .select(section.cols,{count:'exact'})
            .eq('organization_id', organizationId)
            .gte(section.date,start).lt(section.date,end)
            .order(section.date,{ascending:true}).limit(1000);
          if (cancelled) return;
          if (query.error) throw new Error('No fue posible consultar '+section.name+': '+query.error.message);
          const rows = (query.data ?? []) as unknown as DataRow[];
          if (query.count == null || query.count > rows.length)
            throw new Error('La sección '+section.name+' tiene más de 1000 registros o una consulta parcial. No se exportarán cifras incompletas.');
          results.push({name:section.name,columns,rows});
        }
        if (!cancelled) setSheets(results);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'No fue posible elaborar el informe.');
      } finally {if (!cancelled) setLoading(false);}
    })();
    return ()=>{cancelled=true;};
  // permitted is intentionally derived from per-render permissions, but the stable signature
  // below avoids a network loop when the membership object reference changes.
  },[allowed,organizationId,month,revision,permitted.map(item=>item.name).join('|')]);

  if (!allowed) return null;
  const find = (name:string) => sheets.find(s=>s.name===name)?.rows ?? [];
  const rent = rentPeriodTotals(find('Cánones'));
  const billed = rent.expected;
  const paid = rent.paid;
  const ownerNet = financialTotal(find('Liquidaciones'),'net_amount');
  const ownerCommission = financialTotal(find('Liquidaciones'),'commission_amount');
  const ownerOther = financialTotal(find('Liquidaciones'),'other_deductions');
  const totals = [
    ['Canon esperado',billed],['Pago registrado',paid],
    ['Saldo por recaudar (períodos registrados)',rent.outstanding],
    ['Neto registrado para propietarios',ownerNet],
    ['Comisiones de administración en liquidaciones',ownerCommission],
    ['Otras deducciones de propietarios',ownerOther],
  ] as const;

  async function exportXlsx() {
    if (loading || error || exporting || sheets.length===0 || !organizationId) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.utils.book_new();
      const summary: (string|number)[][] = [
        ['INMOJCO · Reporte mensual de inmobiliaria'],
        ['Inmobiliaria',excelSafeCell(branding.companyName)],
        ['Período',month],
        ['Tipo','Exportación interna para revisión contable, NO factura electrónica DIAN'],
        ['Alcance','Solo módulos autorizados y registros correspondientes al período'],
        ['Precisión','Registros comerciales filtrados por fecha de creación; arriendos y liquidaciones por período'],
        [],['Indicador','Valor'],
        ...totals.map(([label,total])=>[label,total]),
        [],['Módulo','Registros exportados'],
        ...sheets.map(item=>[item.name,item.rows.length]),
      ];
      const first=XLSX.utils.aoa_to_sheet(summary);
      first['!cols']=[{wch:55},{wch:36}];
      XLSX.utils.book_append_sheet(book,first,'Resumen');
      for(const section of sheets){
        const grid: (string|number)[][] = [
          [section.name+' · '+month+' · '+branding.companyName],
          section.columns.map(c=>excelSafeCell(c)),
          ...section.rows.map(row=>section.columns.map(col=>excelSafeCell(row[col]))),
        ];
        const sheet=XLSX.utils.aoa_to_sheet(grid);
        sheet['!cols']=section.columns.map(col=>({wch: Math.min(36,Math.max(15,col.length+5))}));
        XLSX.utils.book_append_sheet(book,sheet,section.name.slice(0,31));
      }
      XLSX.writeFile(book,'INMOJCO_'+safeFilename(branding.companyName)+'_'+month+'.xlsx',{compression:true});
    }catch(cause){
      setError(cause instanceof Error?'Error al generar Excel: '+cause.message:'No fue posible generar el Excel.');
    }finally{setExporting(false);}
  }

  return <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5" aria-label="Informes contables mensuales">
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
          disabled={loading||Boolean(error)||exporting||sheets.length===0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          <Download className="h-4 w-4"/>{exporting?'Generando…':'Exportar Excel (.xlsx)'}
        </button>
      </div>
    </div>
    <p className="text-xs text-slate-500">Datos comerciales por fecha de creación; cánones y liquidaciones por mes contable. Los saldos representan registros del sistema, no movimientos bancarios certificados. El Excel puede contener datos personales: almacénalo de forma segura.</p>
    {loading ? <p role="status">Preparando informe…</p> :
      error ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p> :
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {totals.map(([label,total])=><div key={label} className="rounded-xl border border-stone-200 p-3">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-1 text-lg font-bold">{money(total)}</div>
          </div>)}
        </div>
        <div className="flex flex-wrap gap-2">
          {sheets.map(s=><span key={s.name} className="rounded-full bg-stone-100 px-3 py-1 text-xs">{s.name}: {s.rows.length}</span>)}
        </div>
        <p className="text-xs text-slate-500">El archivo incluye «Resumen» y una hoja independiente por sección autorizada. No se exportan registros de otras inmobiliarias.</p>
      </div>}
  </section>;
}
