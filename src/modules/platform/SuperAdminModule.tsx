import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../core/auth-context';
import { supabase } from '../../lib/supabase';
import { monthLabel, organizationStatusLabel, parsePlatformOverview, type OrganizationSummary, type PlatformOverview } from '../../core/platform-overview';
import { BillingAdminControls } from './BillingAdminControls';

export function SuperAdminModule() {
  const { user, activeMembership, loading: authLoading, isPlatformAdmin } = useAuth();
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [billingFilter, setBillingFilter] = useState('ALL');
  const [monthFilter, setMonthFilter] = useState('ALL');
  const [testFilter, setTestFilter] = useState('ALL');
  const [monthLimit, setMonthLimit] = useState(12);
  const [selectedOrganization, setSelectedOrganization] = useState<OrganizationSummary | null>(null);
  const organizations = overview?.organizations ?? [];
  const statuses = [...new Set(organizations.map(org => org.access_status))].sort();
  const billingModes = [...new Set(organizations.map(org => org.billing_mode).filter((mode): mode is string => Boolean(mode)))].sort();
  const months = [...new Set(organizations.map(org => org.registration_month))].sort().reverse();
  const filteredOrganizations = organizations.filter(org => {
    const query = search.trim().toLocaleLowerCase('es');
    return (!query || [org.organization_name,org.organization_slug,org.plan_name ?? ''].some(value => value.toLocaleLowerCase('es').includes(query)))
      && (statusFilter === 'ALL' || org.access_status === statusFilter)
      && (billingFilter === 'ALL' || org.billing_mode === billingFilter)
      && (monthFilter === 'ALL' || org.registration_month === monthFilter)
      && (testFilter === 'ALL' || org.is_test === (testFilter === 'TEST'));
  });
  const refresh = useCallback(async () => {
    if (!user || !isPlatformAdmin) return;
    setLoading(true); setError('');
    try {
      const { data, error: queryError } = await supabase.rpc('platform_organization_overview', { month_limit: monthLimit });
      if (queryError) throw queryError;
      const next = parsePlatformOverview(data);
      setOverview(next);
      setSelectedOrganization(current => current ? next.organizations.find(org => org.organization_id === current.organization_id) ?? null : null);
    } catch {
      setOverview(null); setSelectedOrganization(null);
      setError('No se pudo consultar el resumen. Verifica tu acceso de SuperAdmin y vuelve a intentar.');
    } finally { setLoading(false); }
  }, [user, isPlatformAdmin, monthLimit]);
  useEffect(() => { if (user && isPlatformAdmin) void refresh(); else { setOverview(null); setSelectedOrganization(null); } }, [user, isPlatformAdmin, refresh]);
  if (authLoading) return <main className="min-h-screen bg-slate-50 p-8">Verificando acceso administrativo…</main>;
  if (!user || !isPlatformAdmin) return <main className="min-h-screen bg-slate-50 p-8"><div className="mx-auto max-w-xl rounded-2xl border bg-white p-8">
    <h1 className="text-2xl font-bold">Administración central JCO</h1><p className="mt-3 text-slate-600">Acceso restringido a superadministradores autenticados y activos.</p>
    <a href="/" className="mt-5 inline-block font-semibold text-blue-700 underline">Volver al inicio para iniciar sesión</a>
  </div></main>;
  const totals = overview?.totals;
  const cards = [
    ['Total',totals?.total],['Activas',totals?.active],['Inactivas',totals?.inactive],
    ['Pendientes',totals?.pending],['Suspendidas',totals?.suspended],['Vencidas',totals?.expired],
  ] as const;
  return <main className="min-h-screen bg-slate-50 p-5 text-slate-900 md:p-10"><div className="mx-auto max-w-7xl">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4"><div>
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sistema Inmobiliario JCO</p>
      <h1 className="text-3xl font-bold">Panel de Superadministrador</h1><p className="mt-2 text-sm text-slate-600">Todas tus inmobiliarias · Estado y seguimiento mensual</p>
    </div><div className="flex gap-3"><button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border bg-white px-4 py-2 font-semibold disabled:opacity-50">Actualizar</button>
      {activeMembership && <a href="/?billing=return" className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-900" aria-label="Abrir portal de la inmobiliaria activa">Portal</a>}
      <a href="/" className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">Volver al inicio</a></div></header>
    <nav aria-label="Menú de SuperAdmin" className="mb-6 flex flex-wrap gap-2">
      <a href="#resumen-inmobiliarias" className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Resumen</a>
      <a href="#todas-inmobiliarias" className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Inmobiliarias</a>
      <a href="#resumen-mensual" className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Resumen mensual</a>
    </nav>
    {error && <p role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    <section id="resumen-inmobiliarias" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Estado general de las inmobiliarias">
      {cards.map(([label,value]) => <article key={label} className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-600">{label}</p><p className="mt-2 text-3xl font-bold tabular-nums">{loading || value === undefined ? '—' : value}</p></article>)}
    </section><p className="mt-2 text-xs text-slate-500">{totals ? `${totals.tests} cuentas de prueba incluidas en el total. ` : ''}El estado de acceso contempla la vigencia, las suspensiones y la activación pendiente.</p>
    <BillingAdminControls tenant={selectedOrganization} onDone={() => void refresh()} />
    <section id="todas-inmobiliarias" className="mt-6"><h2 className="text-xl font-bold">Inmobiliarias registradas</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Filtros de inmobiliarias">
        <label className="text-sm font-medium">Buscar<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nombre, identificador o plan" className="mt-1 w-full rounded-lg border bg-white p-3" /></label>
        <label className="text-sm font-medium">Estado<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-3"><option value="ALL">Todos los estados</option>{statuses.map(status => <option key={status} value={status}>{organizationStatusLabel(status)}</option>)}</select></label>
        <label className="text-sm font-medium">Contrato<select value={billingFilter} onChange={e => setBillingFilter(e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-3"><option value="ALL">Todos los contratos</option>{billingModes.map(mode => <option key={mode} value={mode}>{mode}</option>)}</select></label>
        <label className="text-sm font-medium">Mes de registro<select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-3"><option value="ALL">Todos los meses</option>{months.map(month => <option key={month} value={month}>{monthLabel(month)}</option>)}</select></label>
        <label className="text-sm font-medium">Tipo de cuenta<select value={testFilter} onChange={e => setTestFilter(e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-3"><option value="ALL">Todas las cuentas</option><option value="COMMERCIAL">Comerciales</option><option value="TEST">Pruebas</option></select></label>
      </div><p className="mt-3 text-sm text-slate-600" aria-live="polite">Mostrando {filteredOrganizations.length} de {organizations.length} inmobiliarias</p>
      <div className="mt-4 overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[1080px] text-left text-sm"><thead className="bg-slate-100"><tr>
        {['Inmobiliaria','Estado','Plan','Contrato','Vigencia','Miembros','Inmuebles','Registro'].map(label => <th key={label} className="p-4">{label}</th>)}
      </tr></thead><tbody>{filteredOrganizations.map(org => <tr key={org.organization_id} className="border-t">
        <td className="p-4"><p className="font-semibold">{org.organization_name}</p><p className="mt-1 text-xs text-slate-500">{org.organization_slug}</p>
          <button type="button" onClick={() => setSelectedOrganization(org)} className="mt-2 text-xs font-semibold text-blue-700 underline">Gestionar activación</button></td>
        <td className="p-4"><span className={org.access_status === 'ACTIVE' ? 'font-semibold text-emerald-700' : 'font-semibold text-slate-600'}>{organizationStatusLabel(org.access_status)}</span>{org.is_test && <p className="mt-1 text-xs text-amber-800">Cuenta de prueba</p>}</td>
        <td className="p-4">{org.plan_name ?? 'Sin plan'}</td><td className="p-4">{org.billing_mode ?? 'Sin contrato'}<p className="mt-1 text-xs text-slate-500">{org.subscription_status === 'TRIAL' ? 'Prueba autorizada' : org.subscription_status ?? 'Sin suscripción'}</p></td>
        <td className="p-4">{org.access_until ? new Date(org.access_until).toLocaleDateString('es-CO',{timeZone:'America/Bogota'}) : '—'}</td><td className="p-4">{org.member_count}</td><td className="p-4">{org.property_count}</td>
        <td className="p-4">{new Date(org.created_at).toLocaleDateString('es-CO',{timeZone:'America/Bogota'})}</td>
      </tr>)}{!loading && !filteredOrganizations.length && <tr><td colSpan={8} className="p-6 text-center text-slate-500">No hay inmobiliarias que coincidan con estos filtros.</td></tr>}
        {loading && <tr><td colSpan={8} className="p-6 text-center">Cargando inmobiliarias…</td></tr>}</tbody></table></div>
    </section>
    <section id="resumen-mensual" className="mt-8"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Resumen mensual</h2>
      <p className="mt-1 text-sm text-slate-600">Altas por mes y estado actual de esas inmobiliarias. Meses calculados en Colombia.</p></div>
      <label className="text-sm font-medium">Período<select value={monthLimit} onChange={e => setMonthLimit(Number(e.target.value))} className="ml-3 rounded-lg border bg-white p-2"><option value={6}>6 meses</option><option value={12}>12 meses</option><option value={24}>24 meses</option></select></label></div>
      <div className="mt-4 overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[960px] text-left text-sm"><thead className="bg-slate-100"><tr>
        {['Mes de alta','Nuevas','Acumuladas','Activas hoy','Inactivas hoy','Pendientes','Suspendidas','Vencidas','Pruebas'].map(label => <th key={label} className="p-3">{label}</th>)}
      </tr></thead><tbody>{overview?.monthly.map(month => <tr key={month.month} className="border-t"><td className="p-3 font-semibold capitalize">{monthLabel(month.month)}</td>
        {[month.registered,month.accumulated,month.active_now,month.inactive_now,month.pending_now,month.suspended_now,month.expired_now,month.tests].map((value,i) => <td key={i} className="p-3 tabular-nums">{value}</td>)}
      </tr>)}</tbody></table></div>
    </section>
  </div></main>;
}
export default SuperAdminModule;
