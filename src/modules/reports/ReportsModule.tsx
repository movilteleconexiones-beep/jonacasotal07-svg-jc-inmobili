import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Building2, Handshake, UsersRound, WalletCards } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { supabase } from '../../lib/supabase';
import { effectiveCommissionTotals } from '../../core/effective-commissions';
import { monthlyDateBounds } from '../../core/accounting-export';
import { PERMISSIONS } from '../../core/permissions';
import { MonthlyAccountingReport } from './MonthlyAccountingReport';
import type { MonthlyReportSelection } from '../../core/accounting-export';

interface ReportState {
  properties: number;
  contacts: number;
  leads: number;
  wonDeals: number;
  salesClosed: number;
  rentalsClosed: number;
  commercialFees: number;
  adminIntakes: number;
  administrationFees: number;
  pendingCommissions: number;
  paidCommissions: number;
}

const EMPTY: ReportState = {
  properties: 0,
  contacts: 0,
  leads: 0,
  wonDeals: 0,
  salesClosed: 0,
  rentalsClosed: 0,
  commercialFees: 0,
  adminIntakes: 0,
  administrationFees: 0,
  pendingCommissions: 0,
  paidCommissions: 0,
};

export function ReportsModule() {
  const { activeMembership, can } = useAuth();
  const { branding } = useTenantBranding();
  const organizationId = activeMembership?.organization.id;
  const [state, setState] = useState<ReportState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedReport, setSelectedReport] = useState<MonthlyReportSelection | null>(null);
  const [month, setMonth] = useState(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
  });
  const changeMonth=(value:string)=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(value))setMonth(value);};
  const canSeeAdminIntakes = can(PERMISSIONS.PROPERTIES_VIEW) && can(PERMISSIONS.CLIENTS_VIEW);
  const canSeeAdminFees = can(PERMISSIONS.OWNER_STATEMENTS_VIEW);

  useEffect(() => { setSelectedReport(null); }, [organizationId]);

  useEffect(() => {
    let cancelled = false;
    if (!organizationId) {
      setState(EMPTY);
      setError('Selecciona una inmobiliaria para consultar sus reportes.');
      setLoading(false);
      return () => { cancelled = true; };
    }

    async function load() {
      setLoading(true);
      setError('');
      setState(EMPTY);
      try {
        const {start,end}=monthlyDateBounds(month);
        const [properties, contacts, leads, deals, commissions, corrections, consignments, statements] = await Promise.all([
          supabase.from('properties').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
          supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
          supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
          supabase.from('deals')
            .select('id,stage,operation_type,closed_at,final_price,offered_price,asking_price,commission_amount', { count: 'exact' })
            .eq('organization_id', organizationId).eq('stage','WON')
            .gte('closed_at',start+'T00:00:00-05:00').lt('closed_at',end+'T00:00:00-05:00').limit(1000),
          supabase.from('commissions')
            .select('id,status,amount', { count: 'exact' })
            .eq('organization_id', organizationId),
          supabase.from('commission_accounting_corrections').select('commission_id,archived_from_active',{count:'exact'}).eq('organization_id',organizationId).limit(1000),
          canSeeAdminIntakes ? supabase.from('property_consignments')
            .select('payload,reviewed_at,status',{count:'exact'})
            .eq('organization_id',organizationId).eq('status','ACCEPTED')
            .gte('reviewed_at',start+'T00:00:00-05:00').lt('reviewed_at',end+'T00:00:00-05:00').limit(1000) : Promise.resolve(null),
          canSeeAdminFees ? supabase.from('owner_statements')
            .select('commission_amount,status,period_month',{count:'exact'})
            .eq('organization_id',organizationId).eq('status','ISSUED')
            .gte('period_month',start).lt('period_month',end).limit(1000) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        if (properties.error || contacts.error || leads.error || deals.error || commissions.error || corrections.error || consignments?.error || statements?.error) {
          setError('No se pudieron consultar todos los indicadores. Revisa los permisos y actualiza la página.');
          setLoading(false);
          return;
        }

        const dealRows = deals.data ?? [];
        const commissionRows = commissions.data ?? [];
        const correctionRows = corrections.data ?? [];
        const consignmentRows = consignments?.data ?? [];
        const statementRows = statements?.data ?? [];
        const commissionTotals=effectiveCommissionTotals(commissionRows,correctionRows);
        const safeAmount=(value: unknown) => {
          const number=Number(value??0);
          if(!Number.isFinite(number)||number<0)throw new Error('Los importes comerciales contienen valores inválidos.');
          return number;
        };
        if ((deals.count ?? 0) > dealRows.length || (commissions.count ?? 0) > commissionRows.length || (corrections.count ?? 0) > correctionRows.length ||
          (consignments && (consignments.count ?? 0) > consignmentRows.length) || (statements && (statements.count ?? 0) > statementRows.length)) {
          setError('Hay más registros de los que esta consulta puede mostrar. No se presentan totales parciales como si fueran completos.');
          setLoading(false);
          return;
        }

        const next: ReportState = {
          properties: properties.count ?? 0,
          contacts: contacts.count ?? 0,
          leads: leads.count ?? 0,
          wonDeals: dealRows.filter((deal) => deal.stage === 'WON').length,
          salesClosed: dealRows.filter(deal=>deal.stage==='WON'&&deal.operation_type==='SALE')
            .reduce((sum,deal)=>sum+safeAmount(deal.final_price??deal.offered_price??deal.asking_price),0),
          rentalsClosed: dealRows.filter(deal=>deal.stage==='WON'&&deal.operation_type==='RENT')
            .reduce((sum,deal)=>sum+safeAmount(deal.final_price??deal.offered_price??deal.asking_price),0),
          commercialFees: dealRows.filter(deal=>deal.stage==='WON'&&['SALE','RENT'].includes(deal.operation_type))
            .reduce((sum,deal)=>sum+safeAmount(deal.commission_amount),0),
          adminIntakes: consignmentRows.filter(item=>(item.payload as {operation_type?:string}|null)?.operation_type==='ADMINISTRATION').length,
          administrationFees: statementRows.reduce((sum,row)=>sum+safeAmount(row.commission_amount),0),
          pendingCommissions: commissionTotals.pending,
          paidCommissions: commissionTotals.paid,
        };
        setState(next);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setError('No fue posible obtener los reportes. Verifica la conexión e inténtalo nuevamente.');
        setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [organizationId, month, canSeeAdminIntakes, canSeeAdminFees]);

  const money = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(branding.locale || 'es-CO', {
        style: 'currency',
        currency: branding.currency || 'COP',
        maximumFractionDigits: 0,
      }).format(value),
    [branding.locale, branding.currency],
  );

  const cards = [
    { label: 'Propiedades', value: state.properties, icon: Building2, selection: {kind:'module',name:'Propiedades'} as MonthlyReportSelection },
    { label: 'Clientes', value: state.contacts, icon: UsersRound, selection: {kind:'module',name:'Clientes'} as MonthlyReportSelection },
    { label: 'Prospectos', value: state.leads, icon: BarChart3, selection: {kind:'module',name:'CRM'} as MonthlyReportSelection },
    { label: 'Negocios ganados en el mes', value: state.wonDeals, icon: Handshake, selection: {kind:'metric',key:'WON_DEALS'} as MonthlyReportSelection },
  ];

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Reportes</h1>
        <p className="mt-1 text-sm text-slate-600">Cierres por fecha de cierre y período seleccionado. Inventario, clientes y prospectos son acumulados.</p>
        {error && <p role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, selection }) => {
          const chosen=selectedReport?.kind===selection.kind &&
            (selection.kind==='module'
              ? selectedReport?.kind==='module'&&selectedReport.name===selection.name
              : selectedReport?.kind==='metric'&&selectedReport.key===selection.key);
          return <button type="button" key={label} onClick={() => setSelectedReport(selection)}
            aria-pressed={chosen} disabled={loading||Boolean(error)}
            title={'Seleccionar '+label+' para exportar el detalle del mes elegido'}
            className={'rounded-2xl border border-stone-200 bg-white p-5 text-left transition-colors disabled:opacity-60 ' +
              (chosen?'ring-2 ring-slate-900 bg-slate-50':'hover:border-slate-400')}>
            <Icon className="h-5 w-5 text-slate-500" />
            <div className="mt-4 text-3xl font-bold">{loading || error ? '—' : value}</div>
            <div className="mt-1 text-sm text-slate-600">{label}</div>
          </button>;
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white p-4">
        <label htmlFor="commercial-report-month" className="text-sm font-semibold">Mes del reporte comercial</label>
        <input id="commercial-report-month" type="month" value={month}
          onChange={event=>changeMonth(event.target.value)}
          className="rounded-lg border border-stone-300 px-3 py-2" />
        <span className="text-xs text-slate-500">El mismo mes se usa en los informes y archivos Excel.</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Metric title="Ventas cerradas · valor total" value={loading||error?'—':money(state.salesClosed)}
          selected={selectedReport?.kind==='metric'&&selectedReport.key==='SALES_CLOSED'}
          onSelect={()=>setSelectedReport({kind:'metric',key:'SALES_CLOSED'})} />
        <Metric title="Arrendamientos cerrados · canon mensual" value={loading||error?'—':money(state.rentalsClosed)}
          selected={selectedReport?.kind==='metric'&&selectedReport.key==='RENTALS_CLOSED'}
          onSelect={()=>setSelectedReport({kind:'metric',key:'RENTALS_CLOSED'})} />
        <Metric title="Honorarios comerciales pactados · no recaudados" value={loading||error?'—':money(state.commercialFees)}
          selected={selectedReport?.kind==='metric'&&selectedReport.key==='COMMERCIAL_FEES'}
          onSelect={()=>setSelectedReport({kind:'metric',key:'COMMERCIAL_FEES'})} />
        {canSeeAdminIntakes&&<Metric title="Consignaciones de administración aceptadas" value={loading||error?'—':String(state.adminIntakes)}
          selected={selectedReport?.kind==='metric'&&selectedReport.key==='ADMIN_CONSIGNMENTS'}
          onSelect={()=>setSelectedReport({kind:'metric',key:'ADMIN_CONSIGNMENTS'})} />}
        {canSeeAdminFees&&<Metric title="Comisiones de administración emitidas · no necesariamente cobradas" value={loading||error?'—':money(state.administrationFees)}
          selected={selectedReport?.kind==='metric'&&selectedReport.key==='ADMIN_FEES'}
          onSelect={()=>setSelectedReport({kind:'metric',key:'ADMIN_FEES'})} />}
      </div>

      <MonthlyAccountingReport key={organizationId ?? 'no-organization'} month={month}
        onMonthChange={changeMonth} selection={selectedReport} onSelect={setSelectedReport} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Metric title="Comisiones pendientes · acumulado" value={loading || error ? '—' : money(state.pendingCommissions)} />
        <Metric title="Comisiones pagadas · acumulado" value={loading || error ? '—' : money(state.paidCommissions)} />
      </div>
    </section>
  );
}

function Metric({ title, value, selected=false, onSelect }: {
  title: string; value: string; selected?: boolean; onSelect?: () => void;
}) {
  return (
    <button type="button" disabled={!onSelect} onClick={onSelect} aria-pressed={onSelect?selected:undefined}
      title={onSelect?'Seleccionar '+title+' para exportar solo este indicador':undefined}
      className={'rounded-2xl border border-stone-200 bg-white p-5 text-left disabled:cursor-default '+
        (selected?'ring-2 ring-slate-900 bg-slate-50':onSelect?'hover:border-slate-400':'')}>
      <WalletCards className="h-5 w-5 text-slate-500" />
      <div className="mt-4 text-xl font-bold">{value}</div>
      <div className="mt-1 text-sm text-slate-600">{title}</div>
    </button>
  );
}
