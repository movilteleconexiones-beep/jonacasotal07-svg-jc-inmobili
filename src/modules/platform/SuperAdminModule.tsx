import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../core/auth-context';
import { supabase } from '../../lib/supabase';

interface OrganizationSummary {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  organization_status: string;
  created_at: string;
  member_count: number;
  property_count: number;
  subscription_status: string | null;
  billing_mode: string | null;
  plan_name: string | null;
}

export function SuperAdminModule() {
  const { user, loading: authLoading, isPlatformAdmin } = useAuth();
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [billingFilter, setBillingFilter] = useState('ALL');

  const activeCount = organizations.filter((org) => org.organization_status === 'ACTIVE').length;
  const inactiveCount = organizations.length - activeCount;
  const statuses = [...new Set(organizations.map((org) => org.organization_status).filter(Boolean))].sort();
  const billingModes = [...new Set(organizations.map((org) => org.billing_mode).filter((mode): mode is string => Boolean(mode)))].sort();
  const filteredOrganizations = organizations.filter((org) => {
    const query = search.trim().toLocaleLowerCase('es');
    const matchesSearch = !query || [org.organization_name, org.organization_slug, org.plan_name ?? ''].some((value) => value.toLocaleLowerCase('es').includes(query));
    return matchesSearch && (statusFilter === 'ALL' || org.organization_status === statusFilter) && (billingFilter === 'ALL' || org.billing_mode === billingFilter);
  });

  const refresh = useCallback(async () => {
    if (!user || !isPlatformAdmin) return;
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase.rpc('platform_list_organizations');
    if (queryError) {
      setOrganizations([]);
      setError('No se pudo consultar las inmobiliarias. Verifica los permisos de lectura del administrador.');
    } else {
      setOrganizations((data ?? []) as OrganizationSummary[]);
    }
    setLoading(false);
  }, [user, isPlatformAdmin]);

  useEffect(() => {
    if (user && isPlatformAdmin) void refresh();
    else setOrganizations([]);
  }, [user, isPlatformAdmin, refresh]);

  if (authLoading) {
    return <main className="min-h-screen bg-slate-50 p-8">Verificando acceso administrativo…</main>;
  }

  if (!user || !isPlatformAdmin) {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-xl rounded-2xl border bg-white p-8">
          <h1 className="text-2xl font-bold">Administración central JCO</h1>
          <p className="mt-3 text-slate-600">Acceso restringido a superadministradores autenticados y activos.</p>
          <a href="/" className="mt-5 inline-block font-semibold text-blue-700 underline">Volver al inicio para iniciar sesión</a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-900 md:p-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sistema Inmobiliario JCO</p>
            <h1 className="text-3xl font-bold">Panel de Superadministrador</h1>
            <p className="mt-2 text-sm text-slate-600">Inmobiliarias registradas · Consulta de solo lectura</p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold disabled:opacity-50">Actualizar</button>
            <a href="/" className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">Volver al inicio</a>
          </div>
        </header>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-600">Inmobiliarias activas</p>
          <p className="text-3xl font-bold">{activeCount}</p>
          <p className="mt-1 text-xs text-slate-500">{inactiveCount} inactivas u otros estados · {organizations.length} registradas en total</p>
          <p className="mt-2 text-xs text-slate-500">La activación, suspensión y contratación estarán disponibles después de validar sus controles en el servidor.</p>
        </section>
        <section className="mt-5 grid gap-3 md:grid-cols-3" aria-label="Filtros de inmobiliarias">
          <label className="text-sm font-medium">Buscar inmobiliaria
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, identificador o plan" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3" />
          </label>
          <label className="text-sm font-medium">Estado
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3">
              <option value="ALL">Todos los estados (incluye retiradas)</option>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Modalidad de contrato
            <select value={billingFilter} onChange={(event) => setBillingFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3">
              <option value="ALL">Todos los contratos</option>
              {billingModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
            </select>
          </label>
        </section>
        <p className="mt-3 text-sm text-slate-600" aria-live="polite">Mostrando {filteredOrganizations.length} de {organizations.length} inmobiliarias</p>
        {error && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[950px] text-left text-sm">
            <thead className="bg-slate-100"><tr><th className="p-4">Inmobiliaria</th><th className="p-4">Identificador</th><th className="p-4">Estado</th><th className="p-4">Plan</th><th className="p-4">Contrato</th><th className="p-4">Miembros</th><th className="p-4">Inmuebles</th><th className="p-4">Registro</th></tr></thead>
            <tbody>
              {filteredOrganizations.map((org) => (
                <tr key={org.organization_id} className="border-t border-slate-100">
                  <td className="p-4 font-semibold">{org.organization_name}</td>
                  <td className="p-4">{org.organization_slug}</td>
                  <td className="p-4"><span className={org.organization_status === 'ACTIVE' ? 'font-semibold text-emerald-700' : 'font-semibold text-slate-500'}>{org.organization_status === 'ACTIVE' ? 'Activa' : org.organization_status === 'INACTIVE' ? 'Inactiva' : org.organization_status}</span></td>
                  <td className="p-4">{org.plan_name ?? 'Sin plan'}</td>
                  <td className="p-4">{org.billing_mode ?? 'Sin contrato'} · {org.subscription_status ?? 'Sin estado'}</td>
                  <td className="p-4">{org.member_count}</td>
                  <td className="p-4">{org.property_count}</td>
                  <td className="p-4">{org.created_at ? new Date(org.created_at).toLocaleDateString('es-CO') : '—'}</td>
                </tr>
              ))}
              {!loading && filteredOrganizations.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-500">No hay inmobiliarias que coincidan con los filtros. Selecciona «Todos los estados» para consultar también las retiradas.</td></tr>}
              {loading && <tr><td colSpan={8} className="p-6 text-center">Cargando inmobiliarias…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

export default SuperAdminModule;
