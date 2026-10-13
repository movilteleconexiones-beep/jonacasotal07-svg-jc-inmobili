import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { printInternalDocument } from '../../core/financial-documents';
import { financialAmount as amount, rentalBalance, ownerNetFromDeductions, parseMoneyInput } from '../../core/rent-owner-money';

interface Lease {
  id: string;
  tenant_id: string | null;
  contract_number: string | null;
  monthly_rent: number;
  status: string;
}
interface RentPayment {
  id: string;
  lease_id: string;
  period_month: string;
  expected_amount: number;
  paid_amount: number;
  status: string;
}
interface RentAmendment {
  id: string;
  lease_id: string;
  effective_month: string;
  new_monthly_rent: number;
  document_reference: string;
}
interface OwnerStatement {
  id: string;
  owner_id: string | null;
  lease_id: string;
  period_month: string;
  gross_income: number;
  commission_amount: number;
  tax_amount: number;
  other_deductions: number;
  net_amount: number;
  status: string;
}
interface Identity { id: string; first_name: string; last_name: string | null }

const cop = (value: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }).format(value);
const fullName = (person: Identity | undefined) =>
  person ? [person.first_name, person.last_name].filter(Boolean).join(' ') : 'Sin nombre disponible';

/** Read-only tenant obligations. An unregistered payment period is NOT a confirmed debt. */
export function TenantRentBalanceSummary({ organizationId }: { organizationId: string }) {
  const { can, activeMembership } = useAuth();
  const { branding } = useTenantBranding();
  const allowed = can(PERMISSIONS.RENT_PAYMENTS_VIEW) && can(PERMISSIONS.LEASES_VIEW);
  const admin = activeMembership?.roles.some(role => role.key === 'ADMIN') ?? false;
  const canAmend = allowed && admin && can(PERMISSIONS.LEASES_EDIT);
  const canCorrect = allowed && admin && can(PERMISSIONS.RENT_PAYMENTS_CREATE);
  const canReview = allowed && can(PERMISSIONS.RENT_PAYMENTS_CREATE);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [payments, setPayments] = useState<RentPayment[]>([]);
  const [amendments, setAmendments] = useState<RentAmendment[]>([]);
  const [editLease, setEditLease] = useState<string | null>(null);
  const [editPayment, setEditPayment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [contacts, setContacts] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh=()=>setRevision(x=>x+1);
    window.addEventListener('tenant-rent-updated',refresh);
    return()=>window.removeEventListener('tenant-rent-updated',refresh);
  },[]);

  useEffect(() => {
    let cancelled = false;
    setLeases([]); setPayments([]); setContacts([]); setAmendments([]); setError('');
    if (!allowed || !organizationId) { setLoading(false); return () => { cancelled = true; }; }
    setLoading(true);
    void (async () => {
      try {
        const [leaseResult, paymentResult, contactResult, amendmentResult] = await Promise.all([
          supabase.from('leases').select('id,tenant_id,contract_number,monthly_rent,status').eq('organization_id', organizationId),
          supabase.from('rent_payments').select('id,lease_id,period_month,expected_amount,paid_amount,status').eq('organization_id', organizationId).order('period_month', { ascending: false }).limit(100),
          supabase.from('contacts').select('id,first_name,last_name').eq('organization_id', organizationId),
          supabase.from('lease_rent_amendments')
            .select('id,lease_id,effective_month,new_monthly_rent,document_reference')
            .eq('organization_id', organizationId).order('effective_month',{ascending:false}).limit(200),
        ]);
        if (cancelled) return;
        if (leaseResult.error || paymentResult.error || contactResult.error || amendmentResult.error) {
          setError('No se pudieron consultar los cánones y pagos de arriendo. Comprueba tus permisos.');
        } else {
          setLeases((leaseResult.data ?? []) as Lease[]);
          setPayments((paymentResult.data ?? []) as RentPayment[]);
          setContacts((contactResult.data ?? []) as Identity[]);
          setAmendments((amendmentResult.data ?? []) as RentAmendment[]);
        }
      } catch {
        if (!cancelled) setError('No fue posible cargar las obligaciones de arriendo.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [organizationId, allowed, revision]);

  const nextMonth = (() => {
    const now = new Date();
    const first = new Date(now.getFullYear(),now.getMonth()+1,1);
    return [first.getFullYear(),String(first.getMonth()+1).padStart(2,'0')].join('-');
  })();

  async function saveFutureRent(event: FormEvent<HTMLFormElement>,lease:Lease) {
    event.preventDefault();
    if (!canAmend||busy) return;
    const form=new FormData(event.currentTarget);
    const month=String(form.get('month')??'');
    const rent=parseMoneyInput(String(form.get('rent')??''));
    const reason=String(form.get('reason')??'').trim();
    const reference=String(form.get('document_reference')??'').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month<nextMonth||
        !Number.isFinite(rent)||rent<=0||rent>999999999999.99||
        reason.length<10||reason.length>500||
        reference.length<3||reference.length>140) {
      setFeedback('Revisa el mes futuro, importe, motivo (10-500 caracteres) y referencia del otrosí firmado.');
      return;
    }
    if(!window.confirm('¿Programar nuevo canon desde '+month+'? No cambia meses pagados ni extractos existentes.'))return;
    setBusy(true);setFeedback('');
    try {
      const {error:rpcError}=await supabase.rpc('schedule_lease_rent_amendment',{
        target_org:organizationId,target_lease:lease.id,target_month:month+'-01',
        new_amount:rent,change_reason:reason,signed_addendum_reference:reference,
        request_key:crypto.randomUUID(),
      });
      if(rpcError){setFeedback('No se pudo programar el canon: '+rpcError.message);return;}
      setEditLease(null);
      setFeedback('Nuevo canon programado y auditado. Los pagos y meses históricos permanecen sin cambios.');
      window.dispatchEvent(new Event('tenant-rent-updated'));
    }catch{setFeedback('No se confirmó el ajuste. Actualiza antes de intentarlo nuevamente.');}
    finally{setBusy(false);}
  }

  async function saveUnpaidCorrection(event:FormEvent<HTMLFormElement>,payment:RentPayment) {
    event.preventDefault();
    if(!canCorrect||busy)return;
    const form=new FormData(event.currentTarget);
    const expected=parseMoneyInput(String(form.get('expected_amount')??''));
    const reason=String(form.get('reason')??'').trim();
    if(!Number.isFinite(expected)||expected<=0||expected>999999999999.99||
       reason.length<10||reason.length>500){
      setFeedback('Ingresa un canon válido y un motivo de corrección de 10 a 500 caracteres.');return;
    }
    if(!window.confirm('¿Corregir únicamente el importe A pagar? Se conservará una auditoría.'))return;
    setBusy(true);setFeedback('');
    try{
      const {error:rpcError}=await supabase.rpc('correct_unpaid_rent_period',{
        target_org:organizationId,target_payment:payment.id,corrected_amount:expected,reason,
      });
      if(rpcError){setFeedback('No se pudo corregir: '+rpcError.message);return;}
      setEditPayment(null);setFeedback('Cobro pendiente corregido y auditado; no se modificaron recibos.');
      window.dispatchEvent(new Event('tenant-rent-updated'));
    }catch{setFeedback('No se confirmó la corrección. Actualiza antes de reintentar.');}
    finally{setBusy(false);}
  }

  async function requestPaidReview(event:FormEvent<HTMLFormElement>,payment:RentPayment) {
    event.preventDefault();
    if(!canReview||busy)return;
    const reason=String(new FormData(event.currentTarget).get('reason')??'').trim();
    if(reason.length<15||reason.length>500){
      setFeedback('Indica el motivo de revisión (15-500 caracteres).');return;
    }
    if(!window.confirm('¿Registrar solicitud de revisión? No modifica el pago ni su comprobante.'))return;
    setBusy(true);setFeedback('');
    try{
      const {error:rpcError}=await supabase.rpc('request_paid_rent_review',{
        target_org:organizationId,target_payment:payment.id,reason,
      });
      if(rpcError){setFeedback('No fue posible registrar la revisión: '+rpcError.message);return;}
      setEditPayment(null);
      setFeedback('Solicitud de revisión registrada en auditoría. El importe pagado permanece intacto.');
    }catch{setFeedback('No se confirmó la solicitud. Verifica los registros antes de repetirla.');}
    finally{setBusy(false);}
  }

  if (!allowed) return null;
  const byLease = new Map(leases.map(item => [item.id, item]));
  const byContact = new Map(contacts.map(item => [item.id, item]));
  return <section className="rounded-2xl border border-stone-200 bg-white p-5" aria-label="Arriendos de clientes">
    <h2 className="text-lg font-bold">Cánones y pagos de los inquilinos</h2>
    <p className="mt-1 text-sm text-slate-600">Lo que debe pagar cada inquilino a la inmobiliaria. Solo se consideran saldos de períodos registrados, no deudas inferidas.</p>
    <p className="mt-1 text-xs text-slate-600">Los cambios de canon se programan para meses futuros mediante otrosí. Los pagos con abonos o liquidaciones no se reescriben.</p>
    {feedback&&<p role="status" className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm">{feedback}</p>}
    {loading ? <p role="status" className="mt-4 text-sm">Cargando información de arriendos…</p> :
      error ? <p role="alert" className="mt-4 text-sm text-amber-900">{error}</p> :
      <>
        {leases.length > 0 && <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="border-b text-slate-600"><th className="py-2">Inquilino</th><th className="py-2">Contrato</th><th className="py-2 text-right">Canon mensual</th><th className="py-2">Estado</th><th className="py-2">Acciones</th></tr></thead>
            <tbody>{leases.map(lease => <Fragment key={lease.id}><tr className="border-b border-stone-100">
              <td className="py-2">{lease.tenant_id ? fullName(byContact.get(lease.tenant_id)) : 'Sin inquilino asignado'}</td>
              <td className="py-2">{lease.contract_number || '—'}</td>
              <td className="py-2 text-right">
                {cop(amount(lease.monthly_rent))}
                {amendments.filter(a=>a.lease_id===lease.id).map(a=><div key={a.id} className="text-xs text-blue-800">
                  Desde {a.effective_month.slice(0,7)}: {cop(amount(a.new_monthly_rent))}
                </div>)}
              </td>
              <td className="py-2">{lease.status}</td>
              <td className="py-2">
                {canAmend&&['ACTIVE','RENEWAL'].includes(lease.status)&&<button type="button" disabled={busy}
                  onClick={()=>{setEditLease(editLease===lease.id?null:lease.id);setEditPayment(null);setFeedback('');}}
                  className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
                  Editar canon futuro
                </button>}
              </td>
            </tr>
            {editLease===lease.id&&<tr><td colSpan={5} className="border-b bg-slate-50 p-3">
              <form onSubmit={event=>void saveFutureRent(event,lease)} className="grid gap-3 md:grid-cols-2">
                <h4 className="md:col-span-2 font-semibold">Programar nuevo canon mensual</h4>
                <label className="text-sm">A partir de (mes futuro)
                  <input required type="month" name="month" min={nextMonth} defaultValue={nextMonth}
                    className="mt-1 w-full rounded-lg border p-2" />
                </label>
                <label className="text-sm">Nuevo canon mensual (COP)
                  <input required type="number" min="0.01" step="0.01" name="rent"
                    defaultValue={lease.monthly_rent} className="mt-1 w-full rounded-lg border p-2" />
                </label>
                <label className="text-sm">Referencia del otrosí / soporte firmado
                  <input required name="document_reference" minLength={3} maxLength={140}
                    placeholder="Número o referencia del documento" className="mt-1 w-full rounded-lg border p-2" />
                </label>
                <label className="text-sm">Motivo del ajuste
                  <textarea required name="reason" minLength={10} maxLength={500}
                    className="mt-1 w-full rounded-lg border p-2" />
                </label>
                <div className="md:col-span-2 flex justify-end gap-2">
                  <button type="button" disabled={busy} onClick={()=>setEditLease(null)} className="rounded-lg border p-2">Cancelar</button>
                  <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-40">
                    {busy?'Guardando…':'Programar canon'}
                  </button>
                </div>
              </form>
            </td></tr>}
            </Fragment>)}</tbody>
          </table>
        </div>}
        <h3 className="mt-5 font-semibold">Obligaciones mensuales registradas</h3>
        {payments.length === 0 ? <p className="mt-2 text-sm text-slate-500">Todavía no hay períodos de pago registrados; no se puede calcular cartera vencida.</p> :
          <div className="mt-2 overflow-x-auto"><table className="min-w-full text-left text-sm">
            <thead><tr className="border-b text-slate-600"><th className="py-2">Inquilino / Período</th><th className="py-2 text-right">A pagar</th><th className="py-2 text-right">Registrado como pagado</th><th className="py-2 text-right">Saldo pendiente</th><th className="py-2">Estado</th><th className="py-2">Comprobante</th><th className="py-2">Acciones</th></tr></thead>
            <tbody>{payments.map(payment => {
              const lease = byLease.get(payment.lease_id);
              const valid = lease && Number.isFinite(rentalBalance(payment.expected_amount, payment.paid_amount));
              const unpaid = payment.paid_amount===0&&['PENDING','LATE'].includes(payment.status);
              const canEditThisPayment = unpaid ? canCorrect : canReview&&payment.paid_amount>0;
              return <Fragment key={payment.id}><tr className="border-b border-stone-100">
                <td className="py-2">{lease?.tenant_id ? fullName(byContact.get(lease.tenant_id)) : 'Contrato no disponible'}<div className="text-xs text-slate-500">{payment.period_month}</div></td>
                <td className="py-2 text-right">{cop(amount(payment.expected_amount))}</td>
                <td className="py-2 text-right">{cop(amount(payment.paid_amount))}</td>
                <td className="py-2 text-right font-semibold">{valid ? cop(rentalBalance(payment.expected_amount, payment.paid_amount)) : 'Por verificar'}</td>
                <td className="py-2">{payment.status}</td>
                <td className="py-2"><button type="button" disabled={!valid} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-40" onClick={() => {
                  try {
                    printInternalDocument({
                      kind:'TENANT_ACCOUNT',
                      issuer:branding.companyName, logoUrl:branding.logoUrl,
                      recipient:lease?.tenant_id ? fullName(byContact.get(lease.tenant_id)) : 'Inquilino no identificado',
                      reference:lease?.contract_number || payment.lease_id,
                      period:payment.period_month,currency:branding.currency||'COP',
                      recordedStatus:payment.status,
                      lines:[
                        {concept:'Valor registrado a pagar',amount:amount(payment.expected_amount)},
                        {concept:'Abonos registrados',amount:-amount(payment.paid_amount)},
                        {concept:'Saldo pendiente',amount:rentalBalance(payment.expected_amount,payment.paid_amount)},
                      ],
                      note:'Estado de cuenta informativo. No incluye servicios públicos no registrados ni reemplaza recibos de recaudo.',
                    });
                  } catch (cause) {setError(cause instanceof Error?cause.message:'No fue posible emitir el comprobante.');}
                }}>Emitir estado de cuenta</button></td>
                <td className="py-2">
                  {canEditThisPayment&&<button type="button" disabled={busy}
                    onClick={()=>{setEditPayment(editPayment===payment.id?null:payment.id);setEditLease(null);setFeedback('');}}
                    className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
                    {unpaid?'Corregir cobro':'Solicitar revisión'}
                  </button>}
                </td>
              </tr>
              {editPayment===payment.id&&<tr><td colSpan={7} className="border-b bg-slate-50 p-3">
                <form onSubmit={event=>void (unpaid?saveUnpaidCorrection(event,payment):requestPaidReview(event,payment))}
                  className="grid gap-3 md:grid-cols-2">
                  <h4 className="md:col-span-2 font-semibold">
                    {unpaid?'Corregir canon de período sin abonos':'Solicitar revisión de pago registrado'}
                  </h4>
                  {!unpaid&&<p className="md:col-span-2 text-sm text-amber-900">
                    Este período tiene pagos registrados. La solicitud deja constancia en auditoría,
                    pero no altera importes pagados, recibos ni liquidaciones.
                  </p>}
                  {unpaid&&<label className="text-sm">Nuevo importe a pagar (COP)
                    <input required type="number" name="expected_amount" step="0.01" min="0.01"
                      defaultValue={payment.expected_amount} className="mt-1 w-full rounded-lg border p-2" />
                  </label>}
                  <label className="text-sm">Motivo / justificación de la corrección
                    <textarea required name="reason" minLength={unpaid?10:15} maxLength={500}
                      className="mt-1 w-full rounded-lg border p-2" />
                  </label>
                  <div className="md:col-span-2 flex justify-end gap-2">
                    <button type="button" disabled={busy} onClick={()=>setEditPayment(null)} className="rounded-lg border p-2">Cancelar</button>
                    <button type="submit" disabled={busy}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-40">
                      {busy?'Guardando…':unpaid?'Guardar corrección':'Registrar solicitud'}
                    </button>
                  </div>
                </form>
              </td></tr>}
              </Fragment>;
            })}</tbody>
          </table></div>}
        {payments.length === 100 && <p className="mt-2 text-xs text-amber-800">Mostrando hasta 100 períodos recientes; no es un reporte histórico completo.</p>}
      </>}
  </section>;
}

/** Read-only owner liquidation. Statement status is NOT proof of a bank transfer. */
export function OwnerNetStatementsSummary({ organizationId }: { organizationId: string }) {
  const { can } = useAuth();
  const { branding } = useTenantBranding();
  const allowed = can(PERMISSIONS.OWNER_STATEMENTS_VIEW);
  const [statements, setStatements] = useState<OwnerStatement[]>([]);
  const [owners, setOwners] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh=()=>setRevision(x=>x+1);
    window.addEventListener('owner-statement-updated',refresh);
    return()=>window.removeEventListener('owner-statement-updated',refresh);
  },[]);

  useEffect(() => {
    let cancelled = false;
    setStatements([]); setOwners([]); setError('');
    if (!allowed || !organizationId) { setLoading(false); return () => { cancelled = true; }; }
    setLoading(true);
    void (async () => {
      try {
        const [statementResult, ownerResult] = await Promise.all([
          supabase.from('owner_statements')
            .select('id,owner_id,lease_id,period_month,gross_income,commission_amount,tax_amount,other_deductions,net_amount,status')
            .eq('organization_id', organizationId).order('period_month', { ascending: false }).limit(100),
          supabase.from('property_owners').select('id,first_name,last_name').eq('organization_id', organizationId),
        ]);
        if (cancelled) return;
        if (statementResult.error || ownerResult.error) {
          setError('No se pudieron consultar las liquidaciones de los propietarios. Comprueba tus permisos.');
        } else {
          setStatements((statementResult.data ?? []) as OwnerStatement[]);
          setOwners((ownerResult.data ?? []) as Identity[]);
        }
      } catch {
        if (!cancelled) setError('No fue posible cargar las liquidaciones.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [organizationId, allowed, revision]);

  if (!allowed) return null;
  const byOwner = new Map(owners.map(item => [item.id, item]));
  return <section className="rounded-2xl border border-stone-200 bg-white p-5" aria-label="Liquidaciones de propietarios">
    <h2 className="text-lg font-bold">Liquidación del propietario</h2>
    <p className="mt-1 text-sm text-slate-600">Valor neto por entregar después de comisiones, impuestos y otras deducciones. Los servicios públicos y demás conceptos aún están agrupados en «Otras deducciones».</p>
    {loading ? <p role="status" className="mt-4 text-sm">Cargando liquidaciones…</p> :
      error ? <p role="alert" className="mt-4 text-sm text-amber-900">{error}</p> :
      statements.length === 0 ? <p className="mt-4 text-sm text-slate-500">Aún no hay liquidaciones generadas. No se puede establecer un neto a pagar.</p> :
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead><tr className="border-b text-slate-600">
            <th className="py-2">Propietario / Mes</th>
            <th className="py-2 text-right">Bruto</th><th className="py-2 text-right">Comisión</th>
            <th className="py-2 text-right">Impuestos</th><th className="py-2 text-right">Otras deducciones</th>
            <th className="py-2 text-right">Neto a entregar</th><th className="py-2">Estado</th><th className="py-2">Comprobante</th>
          </tr></thead>
          <tbody>{statements.map(statement => {
            const calculated = ownerNetFromDeductions(statement);
            const reconciled = Number.isFinite(calculated) && Math.abs(calculated - amount(statement.net_amount)) < 0.01;
            return <tr key={statement.id} className="border-b border-stone-100">
              <td className="py-2">{statement.owner_id ? fullName(byOwner.get(statement.owner_id)) : 'Propietario no asignado'}<div className="text-xs text-slate-500">{statement.period_month}</div></td>
              <td className="py-2 text-right">{cop(amount(statement.gross_income))}</td>
              <td className="py-2 text-right">{cop(amount(statement.commission_amount))}</td>
              <td className="py-2 text-right">{cop(amount(statement.tax_amount))}</td>
              <td className="py-2 text-right">{cop(amount(statement.other_deductions))}</td>
              <td className="py-2 text-right font-semibold">{reconciled ? cop(amount(statement.net_amount)) : 'Por conciliar'}</td>
              <td className="py-2">{statement.status}{!reconciled && <div className="text-xs text-amber-800">Diferencia en liquidación</div>}</td>
              <td className="py-2"><button type="button" disabled={!reconciled}
                className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                onClick={() => {
                  try {
                    printInternalDocument({
                      kind:'OWNER_SETTLEMENT', issuer:branding.companyName, logoUrl:branding.logoUrl,
                      recipient:statement.owner_id ? fullName(byOwner.get(statement.owner_id)) : 'Propietario no identificado',
                      reference:statement.lease_id,period:statement.period_month,
                      currency:branding.currency||'COP', recordedStatus:statement.status,
                      lines:[
                        {concept:'Ingreso bruto registrado',amount:amount(statement.gross_income)},
                        {concept:'Comisión inmobiliaria',amount:-amount(statement.commission_amount)},
                        {concept:'Impuestos y retenciones registrados',amount:-amount(statement.tax_amount)},
                        {concept:'Otras deducciones registradas (sin desglose)',amount:-amount(statement.other_deductions)},
                        {concept:'Neto a entregar según liquidación',amount:amount(statement.net_amount)},
                      ],
                      note:'Las deducciones individuales y los comprobantes de pago deben ser conciliados por la inmobiliaria. No acredita transferencia al propietario.',
                    });
                  } catch (cause) {setError(cause instanceof Error?cause.message:'No fue posible emitir el comprobante.');}
                }}>Emitir liquidación</button></td>
            </tr>;
          })}</tbody>
        </table>
        <p className="mt-2 text-xs text-slate-600">El estado registrado no confirma por sí solo una transferencia bancaria al propietario.</p>
        {statements.length === 100 && <p className="mt-2 text-xs text-amber-800">Mostrando hasta 100 liquidaciones recientes.</p>}
      </div>}
  </section>;
}
