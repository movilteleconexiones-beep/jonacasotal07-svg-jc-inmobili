import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Building2, Handshake, UsersRound, WalletCards } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { supabase } from '../../lib/supabase';

interface ReportState {
  properties: number;
  contacts: number;
  leads: number;
  wonDeals: number;
  totalDealValue: number;
  pendingCommissions: number;
  paidCommissions: number;
}

const EMPTY: ReportState = {
  properties: 0,
  contacts: 0,
  leads: 0,
  wonDeals: 0,
  totalDealValue: 0,
  pendingCommissions: 0,
  paidCommissions: 0,
};

export function ReportsModule() {
  const { activeMembership } = useAuth();
  const { branding } = useTenantBranding();
  const organizationId = activeMembership?.organization.id;
  const [state, setState] = useState<ReportState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        const [properties, contacts, leads, deals, commissions] = await Promise.all([
          supabase.from('properties').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
          supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
          supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
          supabase.from('deals')
            .select('stage,final_price,offered_price,asking_price', { count: 'exact' })
            .eq('organization_id', organizationId),
          supabase.from('commissions')
            .select('status,amount', { count: 'exact' })
            .eq('organization_id', organizationId),
        ]);
        if (cancelled) return;
        if (properties.error || contacts.error || leads.error || deals.error || commissions.error) {
          setError('No se pudieron consultar todos los indicadores. Revisa los permisos y actualiza la página.');
          setLoading(false);
          return;
        }

        const dealRows = deals.data ?? [];
        const commissionRows = commissions.data ?? [];
        if ((deals.count ?? 0) > dealRows.length || (commissions.count ?? 0) > commissionRows.length) {
          setError('Hay más registros de los que esta consulta puede mostrar. No se presentan totales parciales como si fueran completos.');
          setLoading(false);
          return;
        }

        const next: ReportState = {
          properties: properties.count ?? 0,
          contacts: contacts.count ?? 0,
          leads: leads.count ?? 0,
          wonDeals: dealRows.filter((deal) => deal.stage === 'WON').length,
          totalDealValue: dealRows
            .filter((deal) => deal.stage === 'WON')
            .reduce((sum, deal) => sum + Number(deal.final_price ?? deal.offered_price ?? deal.asking_price ?? 0), 0),
          pendingCommissions: commissionRows
            .filter((item) => item.status !== 'PAID' && item.status !== 'CANCELLED')
            .reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
          paidCommissions: commissionRows
            .filter((item) => item.status === 'PAID')
            .reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
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
  }, [organizationId]);

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
    { label: 'Propiedades', value: state.properties, icon: Building2 },
    { label: 'Clientes', value: state.contacts, icon: UsersRound },
    { label: 'Leads', value: state.leads, icon: BarChart3 },
    { label: 'Negocios ganados', value: state.wonDeals, icon: Handshake },
  ];

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Reportes</h1>
        <p className="mt-1 text-sm text-slate-600">Resumen operativo y comercial de la inmobiliaria.</p>
        {error && <p role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-stone-200 bg-white p-5">
            <Icon className="h-5 w-5 text-slate-500" />
            <div className="mt-4 text-3xl font-bold">{loading || error ? '—' : value}</div>
            <div className="mt-1 text-sm text-slate-600">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Metric title="Valor de cierres ganados" value={loading || error ? '—' : money(state.totalDealValue)} />
        <Metric title="Comisiones pendientes" value={loading || error ? '—' : money(state.pendingCommissions)} />
        <Metric title="Comisiones pagadas" value={loading || error ? '—' : money(state.paidCommissions)} />
      </div>
    </section>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <WalletCards className="h-5 w-5 text-slate-500" />
      <div className="mt-4 text-xl font-bold">{value}</div>
      <div className="mt-1 text-sm text-slate-600">{title}</div>
    </div>
  );
}
