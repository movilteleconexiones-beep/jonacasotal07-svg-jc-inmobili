import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../core/auth-context';
import { supabase } from '../../lib/supabase';
import { LicenseModule } from '../license/LicenseModule';

interface Plan { id: string; name: string; price: number; currency: string; billing_cycle: string; max_users: number | null; max_properties: number | null }
interface Order { id: string; reference: string; status: string; fulfillment_status: string; environment: string; created_at: string; amount_in_cents: number }
const money = (amount: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount);

export function BillingModule() {
  const { activeMembership, refreshMemberships } = useAuth();
  const orgId = activeMembership?.organization.id;
  const billing = activeMembership?.billing;
  const [plans, setPlans] = useState<Plan[]>([]);
  const [lifetimeAvailable,setLifetimeAvailable]=useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [settings, setSettings] = useState<{ sandbox_enabled: boolean; production_enabled: boolean; activation_mode: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const attempts = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    if (!orgId || !billing?.can_manage_billing) return;
    const [catalog, history, config, perpetual] = await Promise.all([
      supabase.from('plans').select('id,name,price,currency,billing_cycle,max_users,max_properties').eq('active', true).in('billing_cycle', ['MONTHLY', 'ANNUAL']).eq('currency', 'COP').order('price'),
      supabase.from('payment_orders').select('id,reference,status,fulfillment_status,environment,created_at,amount_in_cents').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(10),
      supabase.from('billing_activation_settings').select('sandbox_enabled,production_enabled,activation_mode').single(),
      supabase.from('plans').select('id,code,billing_cycle').eq('active',true).eq('code','LIFETIME').eq('billing_cycle','ONE_TIME').maybeSingle(),
    ]);
    if (catalog.error || history.error || config.error || perpetual.error) { setError('No se pudo consultar la facturación. Vuelve a intentar.'); return; }
    setPlans(catalog.data ?? []); setOrders(history.data ?? []); setSettings(config.data);
    setLifetimeAvailable(Boolean(perpetual.data?.id)); setError('');
  }, [orgId, billing?.can_manage_billing]);
  useEffect(() => { attempts.current.clear(); void load(); }, [load]);

  async function refresh() { setBusy(true); try { await Promise.all([load(), refreshMemberships()]); } finally { setBusy(false); } }
  async function checkout(planId: string) {
    if (!orgId || busy) return;
    setBusy(true); setError('');
    const requestKey = attempts.current.get(planId) ?? crypto.randomUUID();
    attempts.current.set(planId, requestKey);
    try {
      const { data, error: requestError } = await supabase.functions.invoke('billing/checkout', {
        body: { organizationId: orgId, planId, requestKey },
      });
      if (requestError || !data) {
        const context = (requestError as { context?: Response } | null)?.context;
        const detail = context instanceof Response ? await context.clone().json().catch(() => null) : null;
        if (detail?.error === 'order_expired') {
          attempts.current.delete(planId);
          throw new Error('La orden venció. Vuelve a elegir el plan para iniciar un nuevo intento.');
        }
        throw new Error('El pago no está disponible. Verifica la activación, los términos y la configuración del comercio.');
      }
      if (data.status) { attempts.current.delete(planId); await refresh(); return; }
      const url = new URL(data.checkoutUrl);
      if (url.origin !== 'https://checkout.wompi.co' || url.pathname !== '/p/') throw new Error('Respuesta de pago inválida.');
      window.location.assign(url.toString());
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo iniciar el pago.'); }
    finally { setBusy(false); }
  }
  if (!billing) return null;
  const available = billing.is_test ? settings?.sandbox_enabled : settings?.production_enabled;
  const paymentLabel = (order: Order) => order.status === 'APPROVED'
    ? order.fulfillment_status === 'APPLIED' ? 'Pago confirmado · acceso activado' : 'Pago confirmado · pendiente de revisión'
    : order.status === 'PENDING' ? 'Pago pendiente de confirmación' : 'Pago no aprobado';
  return <section className="space-y-5">
    <div><h1 className="text-2xl font-bold">Plan y activación</h1>
      <p className="mt-2 text-sm text-slate-600">{billing.operational ? 'Tu inmobiliaria está habilitada.' : billing.status === 'SUSPENDED' || billing.status === 'INACTIVE'
        ? 'La inmobiliaria está suspendida o inactiva. Contacta al administrador.' : 'La inmobiliaria está registrada y pendiente de activación.'}</p>
      {billing.period_end && <p className="mt-1 text-sm">Vigencia hasta {new Date(billing.period_end).toLocaleDateString('es-CO')}.</p>}
    </div>
    <p className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-slate-700">Los pagos por Wompi corresponden exclusivamente a las licencias y suscripciones de INMOJCO, cobradas por el comercio central del propietario del software. La inmobiliaria contrata el derecho de uso para su propia operación; no puede revender, sublicenciar ni redistribuir INMOJCO, ni operar como distribuidora del sistema.</p>
    {billing.can_manage_billing ? <>
      {billing.is_test && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Inmobiliaria de prueba · Entorno de pruebas. Los pagos de esta cuenta no habilitan otras inmobiliarias.</p>}
      <p className="rounded-xl border bg-white p-4 text-sm">{settings?.activation_mode === 'MANUAL'
        ? 'Los pagos confirmados requieren revisión del superadministrador.'
        : 'La confirmación del pago habilita automáticamente los módulos de tu plan. El regreso desde Wompi no confirma el pago.'}</p>
      {!available && <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Los cobros están pendientes de habilitación del comercio. Puedes consultar los planes; el superadministrador puede autorizar el acceso manualmente.</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
      <div className="grid gap-4 md:grid-cols-3">{plans.map(plan => <article key={plan.id} className="rounded-2xl border bg-white p-5">
        <h2 className="font-bold">{plan.name}</h2><p className="mt-3 text-2xl font-bold">{money(Number(plan.price))}</p>
        <p className="text-sm text-slate-600">{plan.billing_cycle === 'ANNUAL' ? 'Por año' : 'Por mes'} · Total comercial 2026</p>
        <p className="mt-3 text-sm">{plan.max_users ? `${plan.max_users} usuarios` : 'Usuarios según contrato'} · {plan.max_properties ? `${plan.max_properties} inmuebles` : 'Inmuebles según contrato'}</p>
        <button type="button" disabled={busy || !available || !billing.terms_accepted || ['SUSPENDED','INACTIVE'].includes(billing.status)}
          onClick={() => void checkout(plan.id)} className="mt-4 w-full rounded-xl bg-slate-900 p-3 text-sm font-semibold text-white disabled:opacity-40">
          {billing.is_test ? 'Probar pago en entorno de pruebas' : 'Elegir plan y pagar'}</button>
      </article>)}</div>
      {lifetimeAvailable && <section aria-label="Licencia vitalicia" className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-lg font-bold">INMOJCO Vitalicio · pago único</h2>
        <p className="mt-2 text-sm text-slate-700">
          Licencia perpetua para el uso interno de la inmobiliaria, disponible mediante cotización
          y contrato individual. Conservas el acceso según las condiciones de la licencia adquirida,
          sin transferencia de derechos de autor, reventa ni sublicenciamiento.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          No incluye automáticamente alojamiento, soporte, mantenimiento o actualizaciones
          indefinidas. Estos servicios y los límites de usuarios e inmuebles se definen por contrato.
        </p>
        <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Precio vitalicio pendiente de aprobación. No está habilitado para compra automática
          con Wompi. Solicita una cotización al administrador comercial de INMOJCO.
        </p>
      </section>}
      <div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-bold">Historial de pagos</h2>
        <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-lg border px-4 py-2 text-sm">Comprobar estado</button></div>
        <ul className="mt-4 space-y-3">{orders.map(order => <li key={order.id} className="rounded-lg bg-stone-50 p-3 text-sm">
          <p className="font-semibold">{paymentLabel(order)}</p><p>{money(order.amount_in_cents / 100)} · {order.environment === 'sandbox' ? 'Prueba' : 'Producción'}</p>
          <p className="break-all text-xs text-slate-500">{order.reference}</p>
        </li>)}</ul>{!orders.length && <p className="mt-4 text-sm text-slate-500">Aún no hay pagos registrados.</p>}
      </div>
      <LicenseModule onAccepted={() => void refreshMemberships()} />
    </> : <p className="rounded-xl border bg-white p-5">El propietario de la inmobiliaria administra la contratación y los pagos.</p>}
  </section>;
}
