import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Tenant { organization_id: string; organization_name: string; organization_status: string; owner_user_id: string | null }
interface Plan { id: string; name: string; code: string; billing_cycle: string; currency: string }
interface WompiReview { id: string; amount_in_cents: number; currency: string; created_at: string }
export function BillingAdminControls({ tenant, onDone }: { tenant: Tenant | null; onDone: () => void }) {
  const [mode, setMode] = useState('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [configuredPlanIds, setConfiguredPlanIds] = useState<string[]>([]);
  const [plan, setPlan] = useState('');
  const [action, setAction] = useState('APPROVE');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [verifiedReviews, setVerifiedReviews] = useState<WompiReview[]>([]);
  useEffect(() => {
    void Promise.all([
      supabase.from('billing_activation_settings').select('activation_mode').single(),
      supabase.from('plans').select('id,name,code,billing_cycle,currency').eq('active',true).in('billing_cycle',['MONTHLY','ANNUAL']).order('price'),
      supabase.from('plan_features').select('plan_id').eq('enabled',true).like('feature_key','permission:%'),
    ]).then(([config,catalog,features]) => { if (config.error || catalog.error || features.error) { setMessage('No se pudo consultar la configuración comercial y los permisos de los planes.'); return; }
      setMode(config.data.activation_mode); setPlans(catalog.data ?? []); setConfiguredPlanIds([...new Set((features.data ?? []).map(f => f.plan_id))]); });
  }, []);
  useEffect(() => { setReason(''); setPlan(''); setAction('APPROVE'); setMessage(''); }, [tenant?.organization_id]);
  useEffect(() => {
    setVerifiedReviews([]);
    if (!tenant?.organization_id) return;
    let cancelled = false;
    void supabase.from('payment_orders')
      .select('id,amount_in_cents,currency,created_at')
      .eq('organization_id',tenant.organization_id)
      .eq('environment','sandbox').eq('status','APPROVED')
      .eq('fulfillment_status','REVIEW_REQUIRED').eq('review_reason','contract_review')
      .order('created_at',{ascending:false}).limit(5)
      .then(({data,error}) => {
        if (!cancelled && !error) setVerifiedReviews(data ?? []);
      });
    return () => { cancelled=true; };
  }, [tenant?.organization_id]);
  async function saveMode(next: string) {
    setBusy(true); setMessage('');
    const { error } = await supabase.rpc('billing_admin_set_mode',{ mode: next });
    if (error) setMessage('No se pudo cambiar la modalidad. Verifica tu acceso de superadministrador.');
    else { setMode(next); setMessage('Modalidad guardada. Los pagos requieren confirmación auténtica de Wompi.'); }
    setBusy(false);
  }
  async function apply() {
    if (!tenant || busy) return;
    if ((action==='APPROVE'||action==='TRIAL') && !configuredPlanIds.includes(plan)) {
      setMessage('Este plan no tiene permisos comerciales configurados. Debe revisarse el catálogo antes de autorizar acceso.');
      return;
    }
    setBusy(true); setMessage('');
    const { error } = action === 'TRIAL'
      ? await supabase.rpc('billing_admin_authorize_trial', { target_org: tenant.organization_id, target_owner: tenant.owner_user_id, target_plan: plan, trial_days:30, reason:reason.trim() })
      : await supabase.rpc('billing_admin_action', { target_org: tenant.organization_id,
        action, reason: reason.trim(), target_plan: action === 'APPROVE' ? plan : null });
    if (error) setMessage('No se pudo aplicar el cambio. Verifica los requisitos del contrato, los permisos configurados y la elegibilidad de la cuenta.');
    else { setMessage('Cambio aplicado y registrado en auditoría.'); onDone(); }
    setBusy(false);
  }
  async function reconcileVerifiedTrial(orderId: string) {
    if (!tenant || busy || reason.trim().length < 10 ||
      !verifiedReviews.some(o => o.id===orderId)) return;
    setBusy(true); setMessage('');
    const {data,error} = await supabase.rpc('billing_admin_reconcile_verified_trial_payment',
      { target_order:orderId,justification:reason.trim() });
    if (error) setMessage('No fue posible conciliar el pago; verifica que esté aprobado y el contrato continúe en prueba.');
    else if (data==='applied' || data==='already_applied') {
      setVerifiedReviews(items => items.filter(order => order.id!==orderId));
      setMessage(data==='applied'
        ? 'Pago de prueba verificado y aplicado una sola vez. Conciliación registrada en auditoría.'
        : 'El pago ya estaba aplicado. No se modificó la licencia.');
      onDone();
    } else setMessage('El pago permanece en revisión. No se cambió la licencia; revisa el contrato o la evidencia.');
    setBusy(false);
  }
  return <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-bold">Activación comercial</h2>
      <p className="mt-1 text-sm text-slate-600">El pago confirmado puede habilitar el plan automáticamente. Las suspensiones administrativas requieren revisión.</p></div>
      <label className="text-sm font-medium">Modalidad
        <select aria-label="Modalidad de activación" value={mode} disabled={busy || !mode} onChange={e => void saveMode(e.target.value)} className="ml-3 rounded-lg border p-2">
          <option value="VERIFIED_PAYMENT">Automática por pago verificado</option><option value="MANUAL">Autorización del superadministrador</option>
        </select></label></div>
    {tenant && <div className="mt-5 border-t pt-5"><h3 className="font-semibold">Gestionar {tenant.organization_name}</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-sm">Acción
        <select aria-label="Acción administrativa" value={action} onChange={e=>{setAction(e.target.value);setPlan('');}} className="mt-1 w-full rounded-lg border p-3">
          <option value="APPROVE">Autorizar acceso por un período del plan</option><option value="TRIAL" disabled={!tenant.owner_user_id}>Autorizar prueba completa por 30 días</option><option value="SUSPEND">Suspender operación</option><option value="MARK_TEST">Marcar cuenta pendiente para entorno de pruebas</option>
        </select></label>
        {(action==='APPROVE' || action==='TRIAL') && <label className="text-sm">Plan
          <select aria-label="Plan para autorización" value={plan} onChange={e=>setPlan(e.target.value)} className="mt-1 w-full rounded-lg border p-3">
            <option value="">Selecciona un plan</option>{plans.filter(p=>action==='TRIAL' ? p.billing_cycle==='MONTHLY' && ['PRO','ENTERPRISE'].includes(p.code) : true).map(p=><option key={p.id} value={p.id}>{p.name} · {p.currency}{configuredPlanIds.includes(p.id) ? '' : ' · pendiente de configurar'}</option>)}
          </select></label>}
      </div>{(action==='APPROVE'||action==='TRIAL') && plans.length>0 && configuredPlanIds.length===0 && <p role="status" className="mt-3 text-sm text-amber-800">Los planes existen, pero todavía no tienen permisos habilitados en el catálogo comercial. No se puede autorizar un período nuevo hasta completar esa configuración.</p>}<label className="mt-3 block text-sm">Motivo (queda en auditoría)
        <textarea aria-label="Motivo del cambio" value={reason} minLength={10} maxLength={1000} onChange={e=>setReason(e.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
      <button type="button" disabled={busy || reason.trim().length<10 || ((action==='APPROVE'||action==='TRIAL') && (!plan || !configuredPlanIds.includes(plan))) || (action==='TRIAL' && !tenant.owner_user_id)} onClick={()=>void apply()} className="mt-3 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">Aplicar cambio</button>
    </div>}
    {tenant && verifiedReviews.length>0 && <section aria-label="Conciliación Wompi verificada" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h3 className="font-semibold">Pago Wompi aprobado pendiente de aplicar</h3>
      <p className="mt-1 text-sm">Solo pagos Sandbox confirmados y retenidos al cambiar de un plan en prueba a otro plan. Requiere motivo y autorización exclusiva del SuperAdmin. No crea ni repite cargos.</p>
      {verifiedReviews.map(order=><div key={order.id} className="mt-3 rounded-lg border bg-white p-3">
        <p className="text-sm">{(order.amount_in_cents/100).toLocaleString('es-CO',{style:'currency',currency:order.currency})} · {new Date(order.created_at).toLocaleDateString('es-CO')}</p>
        <button type="button" disabled={busy || reason.trim().length<10}
          onClick={()=>void reconcileVerifiedTrial(order.id)}
          className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          Conciliar pago firmado y activar plan
        </button>
      </div>)}
      <p className="mt-2 text-xs">El motivo de auditoría se escribe en el campo «Motivo» anterior. La base de datos volverá a comprobar firma, contrato y seguridad antes de aplicar.</p>
    </section>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>
  </section>;
}
