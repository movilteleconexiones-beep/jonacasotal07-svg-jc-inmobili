import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Tenant { organization_id: string; organization_name: string; organization_status: string; owner_user_id: string | null }
interface Plan { id: string; name: string; code: string; billing_cycle: string; currency: string }
export function BillingAdminControls({ tenant, onDone }: { tenant: Tenant | null; onDone: () => void }) {
  const [mode, setMode] = useState('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [configuredPlanIds, setConfiguredPlanIds] = useState<string[]>([]);
  const [plan, setPlan] = useState('');
  const [action, setAction] = useState('APPROVE');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void Promise.all([
      supabase.from('billing_activation_settings').select('activation_mode').single(),
      supabase.from('plans').select('id,name,code,billing_cycle,currency').eq('active',true).eq('billing_cycle','MONTHLY').eq('currency','COP').in('code',['BASIC','PRO']).order('price'),
      supabase.from('plan_features').select('plan_id').eq('enabled',true).like('feature_key','permission:%'),
    ]).then(([config,catalog,features]) => { if (config.error || catalog.error || features.error) { setMessage('No se pudo consultar la configuración comercial y los permisos de los planes.'); return; }
      setMode(config.data.activation_mode); setPlans(catalog.data ?? []); setConfiguredPlanIds([...new Set((features.data ?? []).map(f => f.plan_id))]); });
  }, []);
  useEffect(() => { setReason(''); setPlan(''); setAction('APPROVE'); setMessage(''); }, [tenant?.organization_id]);
  async function saveMode(next: string) {
    setBusy(true); setMessage('');
    const { error } = await supabase.rpc('billing_admin_set_mode',{ mode: next });
    if (error) setMessage('No se pudo cambiar la modalidad. Verifica tu acceso de superadministrador.');
    else { setMode(next); setMessage('Modalidad guardada. Los pagos requieren confirmación auténtica de Wompi.'); }
    setBusy(false);
  }
  async function apply() {
    if (!tenant || busy) return;
    if (action==='APPROVE' && (!plans.some(item => item.id === plan) || !configuredPlanIds.includes(plan))) {
      setMessage('Este plan no tiene permisos comerciales configurados. Debe revisarse el catálogo antes de autorizar acceso.');
      return;
    }
    setBusy(true); setMessage('');
    const { error } = await supabase.rpc('billing_admin_action', {
      target_org: tenant.organization_id,
      action,
      reason: reason.trim(),
      target_plan: action === 'APPROVE' ? plan : null,
    });
    if (error) setMessage('No se pudo aplicar el cambio. Verifica los requisitos del contrato, los permisos configurados y la elegibilidad de la cuenta.');
    else { setMessage('Cambio aplicado y registrado en auditoría.'); onDone(); }
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
          <option value="APPROVE">Autorizar acceso por un período del plan</option><option value="SUSPEND">Suspender operación</option><option value="MARK_TEST">Marcar cuenta pendiente para entorno de pruebas</option>
        </select></label>
        {action==='APPROVE' && <label className="text-sm">Plan
          <select aria-label="Plan para autorización" value={plan} onChange={e=>setPlan(e.target.value)} className="mt-1 w-full rounded-lg border p-3">
            <option value="">Selecciona un plan</option>{plans.map(p=><option key={p.id} value={p.id}>{p.name} · {p.currency}{configuredPlanIds.includes(p.id) ? '' : ' · pendiente de configurar'}</option>)}
          </select></label>}
      </div>{action==='APPROVE' && plans.length>0 && configuredPlanIds.length===0 && <p role="status" className="mt-3 text-sm text-amber-800">Los planes existen, pero todavía no tienen permisos habilitados en el catálogo comercial. No se puede autorizar un período nuevo hasta completar esa configuración.</p>}<label className="mt-3 block text-sm">Motivo (queda en auditoría)
        <textarea aria-label="Motivo del cambio" value={reason} minLength={10} maxLength={1000} onChange={e=>setReason(e.target.value)} className="mt-1 w-full rounded-lg border p-3" /></label>
      <button type="button" disabled={busy || reason.trim().length<10 || (action==='APPROVE' && (!plans.some(item => item.id === plan) || !configuredPlanIds.includes(plan)))} onClick={()=>void apply()} className="mt-3 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">Aplicar cambio</button>
    </div>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
