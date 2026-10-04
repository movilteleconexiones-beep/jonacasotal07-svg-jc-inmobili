import { useEffect, useMemo, useState } from 'react';
import { Building2, CreditCard, RefreshCw, ShieldCheck, UsersRound } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface PlatformOrgRow {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  organization_status: string;
  created_at: string;
  member_count: number;
  property_count: number;
  contact_count: number;
  lead_count: number;
  subscription_status: string | null;
  billing_mode: string | null;
  plan_code: string | null;
  plan_name: string | null;
}

interface PlanRow {
  code: string;
  name: string;
  billing_cycle: string;
  price: number;
  currency: string;
  active: boolean;
}

export function SuperAdminModule() {
  const [organizations, setOrganizations] = useState<PlatformOrgRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setMessage('');

    const [organizationsResult, plansResult] = await Promise.all([
      supabase.rpc('platform_list_organizations'),
      supabase
        .from('plans')
        .select('code,name,billing_cycle,price,currency,active')
        .order('name'),
    ]);

    if (organizationsResult.error) {
      setMessage(organizationsResult.error.message);
      setOrganizations([]);
    } else {
      setOrganizations((organizationsResult.data ?? []) as PlatformOrgRow[]);
    }

    if (!plansResult.error) {
      setPlans((plansResult.data ?? []) as PlanRow[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function updateSubscription(
    organizationId: string,
    planCode: string,
    billingMode: string,
    status: string,
  ) {
    const { error } = await supabase.rpc('platform_set_subscription', {
      target_org: organizationId,
      target_plan_code: planCode,
      target_billing_mode: billingMode,
      target_status: status,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Plan y modalidad actualizados.');
    await load();
  }

  const totals = useMemo(() => ({
    organizations: organizations.length,
    users: organizations.reduce((sum, row) => sum + Number(row.member_count || 0), 0),
    properties: organizations.reduce((sum, row) => sum + Number(row.property_count || 0), 0),
    leads: organizations.reduce((sum, row) => sum + Number(row.lead_count || 0), 0),
  }), [organizations]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
            <ShieldCheck className="h-3.5 w-3.5" />
            Administración de plataforma
          </div>
          <h1 className="mt-3 text-2xl font-bold">Super Admin SaaS</h1>
          <p className="mt-1 text-sm text-slate-600">
            Gestiona inmobiliarias, planes y modalidades comerciales de Sistema Inmobiliario JCO.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold"
        >
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Summary icon={Building2} label="Inmobiliarias" value={totals.organizations} />
        <Summary icon={UsersRound} label="Usuarios activos" value={totals.users} />
        <Summary icon={Building2} label="Propiedades" value={totals.properties} />
        <Summary icon={CreditCard} label="Leads registrados" value={totals.leads} />
      </div>

      {message && (
        <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm text-slate-700">
          {message}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="px-4 py-3">Inmobiliaria</th>
              <th className="px-4 py-3">Usuarios</th>
              <th className="px-4 py-3">Propiedades</th>
              <th className="px-4 py-3">Clientes</th>
              <th className="px-4 py-3">Leads</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Modalidad</th>
              <th className="px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((row) => (
              <tr key={row.organization_id} className="border-t border-stone-100">
                <td className="px-4 py-3">
                  <div className="font-semibold">{row.organization_name}</div>
                  <div className="mt-1 text-xs text-slate-500">{row.organization_slug}</div>
                </td>
                <td className="px-4 py-3">{row.member_count}</td>
                <td className="px-4 py-3">{row.property_count}</td>
                <td className="px-4 py-3">{row.contact_count}</td>
                <td className="px-4 py-3">{row.lead_count}</td>
                <td className="px-4 py-3">
                  <select
                    defaultValue={row.plan_code ?? 'BASIC'}
                    onChange={(event) =>
                      void updateSubscription(
                        row.organization_id,
                        event.target.value,
                        row.billing_mode ?? 'SAAS_MONTHLY',
                        row.subscription_status ?? 'ACTIVE',
                      )
                    }
                    className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                  >
                    {plans.map((plan) => (
                      <option key={plan.code} value={plan.code}>{plan.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    defaultValue={row.billing_mode ?? 'SAAS_MONTHLY'}
                    onChange={(event) =>
                      void updateSubscription(
                        row.organization_id,
                        row.plan_code ?? 'BASIC',
                        event.target.value,
                        row.subscription_status ?? 'ACTIVE',
                      )
                    }
                    className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                  >
                    <option value="SAAS_MONTHLY">Mensual</option>
                    <option value="SAAS_ANNUAL">Anual</option>
                    <option value="LIFETIME">Licencia perpetua</option>
                    <option value="DEDICATED">Instalación dedicada</option>
                    <option value="CUSTOM">Personalizada</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    defaultValue={row.subscription_status ?? 'ACTIVE'}
                    onChange={(event) =>
                      void updateSubscription(
                        row.organization_id,
                        row.plan_code ?? 'BASIC',
                        row.billing_mode ?? 'SAAS_MONTHLY',
                        event.target.value,
                      )
                    }
                    className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                  >
                    <option value="TRIAL">Prueba</option>
                    <option value="ACTIVE">Activa</option>
                    <option value="PAST_DUE">Pago vencido</option>
                    <option value="SUSPENDED">Suspendida</option>
                    <option value="CANCELLED">Cancelada</option>
                    <option value="LIFETIME">Perpetua</option>
                  </select>
                </td>
              </tr>
            ))}

            {!loading && organizations.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No hay inmobiliarias visibles para esta cuenta de plataforma.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Summary({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <Icon className="h-5 w-5 text-slate-500" />
      <div className="mt-4 text-3xl font-bold">{value}</div>
      <div className="mt-1 text-sm text-slate-600">{label}</div>
    </div>
  );
}
