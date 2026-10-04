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

  useEffect(() => {
    if (!organizationId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);

      const [properties, contacts, leads, deals, commissions] = await Promise.all([
        supabase.from('properties').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
        supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
        supabase
          .from('deals')
          .select('stage,final_price,offered_price,asking_price')
          .eq('organization_id', organizationId),
        supabase
          .from('commissions')
          .select('status,amount')
          .eq('organization_id', organizationId),
      ]);

      const dealRows = deals.data ?? [];
      const commissionRows = commissions.data ?? [];

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

      if (!cancelled) {
        setState(next);
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-stone-200 bg-white p-5">
            <Icon className="h-5 w-5 text-slate-500" />
            <div className="mt-4 text-3xl font-bold">{loading ? '—' : value}</div>
            <div className="mt-1 text-sm text-slate-600">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Metric title="Valor de cierres ganados" value={loading ? '—' : money(state.totalDealValue)} />
        <Metric title="Comisiones pendientes" value={loading ? '—' : money(state.pendingCommissions)} />
        <Metric title="Comisiones pagadas" value={loading ? '—' : money(state.paidCommissions)} />
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
