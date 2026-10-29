import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { etiquetaES } from '../../core/etiquetas-es';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { printInternalDocument } from '../../core/financial-documents';
import { financialAmount as amount, rentalBalance, ownerNetFromDeductions, parseMoneyInput } from '../../core/rent-owner-money';
import { rentPeriodCanonDiscrepancy } from '../../core/rent-period-canon-audit';

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

  async function saveUnpaidCorrection(event:FormEvent<HTMLFormElement>,payment:RentPayment,verifySignedCanon:boolean) {
    event.preventDefault();
    if(!canCorrect||busy)return;
    const form=new FormData(event.currentTarget);
    const expected=parseMoneyInput(String(form.get('expected_amount')??''));
    const reason=String(form.get('reason')??'').trim();
    if(verifySignedCanon && form.get('verified_canon') !== 'yes'){
      setFeedback('Antes de corregir, confirma que verificaste el contrato firmado y los otrosíes vigentes.');return;
    }
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
  // An incomplete list of addenda cannot establish the applicable signed canon.
  const flaggedPeriods = amendments.length < 200 ? payments.filter(payment => {
    const lease = byLease.get(payment.lease_id);
    return lease && rentPeriodCanonDiscrepancy(lease.monthly_rent, payment, amendments);
  }) : [];
  return <section className="rounded-2xl border border-stone-200 bg-white p-5" aria-label="Arriendos de clientes">
    <h2 className="text-lg font-bold">Cánones y pagos de los inquilinos</h2>
    <p className="mt-1 text-sm text-slate-600">Lo que debe pagar cada inquilino a la inmobiliaria. Solo se consideran saldos de períodos registrados, no deudas inferidas.</p>
    <p className="mt-1 text-xs text-slate-600">Los cambios de canon se programan para meses futuros mediante otrosí. Los pagos con abonos o liquidaciones no se reescriben.</p>
    {!loading && !error && amendments.length >= 200 && <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      La lista de otrosíes alcanzó su límite de consulta. No se evalúan diferencias de canon hasta consultar el historial completo.
    </p>}
    {!loading && !error && flaggedPeriods.length > 0 && <p role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      Cánones registrados por revisar: {flaggedPeriods.length} período(s) con un importe distinto al canon firmado aplicable en ese mes.
      Comprueba el contrato y sus otrosíes antes de corregir. Es una advertencia informativa: No modifica cobros, recibos ni liquidaciones.
    </p>}
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
              <td className="py-2">{etiquetaES(lease.status)}</td>
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
              const difference = lease && amendments.length < 200
                ? rentPeriodCanonDiscrepancy(lease.monthly_rent,payment,amendments) : null;
              return <Fragment key={payment.id}><tr className="border-b border-stone-100">
                <td className="py-2">{lease?.tenant_id ? fullName(byContact.get(lease.tenant_id)) : 'Contrato no disponible'}<div className="text-xs text-slate-500">{payment.period_month}</div></td>
                <td className="py-2 text-right">{cop(amount(payment.expected_amount))}
                  {difference&&<p role="alert" className="mt-1 text-xs font-medium text-amber-900">
                    Referencia documental ({difference.reference==='OTROSI'?'otrosí':'contrato'}): {cop(difference.referenceCanon)}.
                    Diferencia de {cop(difference.difference)} {difference.direction} al canon firmado. Verifica este período.
                  </p>}
                </td>
                <td className="py-2 text-right">{cop(amount(payment.paid_amount))}</td>
                <td className="py-2 text-right font-semibold">{valid ? cop(rentalBalance(payment.expected_amount, payment.paid_amount)) : 'Por verificar'}</td>
                <td className="py-2">{etiquetaES(payment.status)}</td>
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
                    {unpaid ? (difference?'Revisar canon y corregir':'Corregir cobro') : 'Solicitar revisión'}
                  </button>}
                </td>
              </tr>
              {editPayment===payment.id&&<tr><td colSpan={7} className="border-b bg-slate-50 p-3">
                <form onSubmit={event=>void (unpaid?saveUnpaidCorrection(event,payment,Boolean(difference)):requestPaidReview(event,payment))}
                  className="grid gap-3 md:grid-cols-2">
                  <h4 className="md:col-span-2 font-semibold">
                    {unpaid?'Corregir canon de período sin abonos':'Solicitar revisión de pago registrado'}
                  </h4>
                  {!unpaid&&<p className="md:col-span-2 text-sm text-amber-900">
                    Este período tiene pagos registrados. La solicitud deja constancia en auditoría,
                    pero no altera importes pagados, recibos ni liquidaciones.
                  </p>}
                  {unpaid&&difference&&<p className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Importe propuesto según {difference.reference==='OTROSI'?'otrosí vigente':'contrato firmado'} para {difference.period}: {cop(difference.referenceCanon)}.
                    Comprueba el documento original: la propuesta es editable y no se guardará automáticamente.
                  </p>}
                  {unpaid&&<label className="text-sm">Nuevo importe a pagar (COP)
                    <input required type="number" name="expected_amount" step="0.01" min="0.01"
                      defaultValue={difference?.referenceCanon ?? payment.expected_amount} className="mt-1 w-full rounded-lg border p-2" />
                  </label>}
                  {unpaid&&difference&&<label className="md:col-span-2 flex items-start gap-2 text-sm">
                    <input required type="checkbox" name="verified_canon" value="yes" className="mt-1" />
                    <span>Verifiqué el contrato firmado y sus otrosíes para este mes y confirmo que el importe propuesto corresponde al acuerdo aplicable.</span>
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
  const { can,activeMembership } = useAuth();
  const { branding } = useTenantBranding();
  const allowed = can(PERMISSIONS.OWNER_STATEMENTS_VIEW);
  const mayIssue = can(PERMISSIONS.OWNER_STATEMENTS_CREATE) && (activeMembership?.roles.some(role=>role.key==='ADMIN'||role.key==='ORGANIZATION_OWNER')??false);
  const [issuing,setIssuing] = useState(false);
  const [payoutStatementId,setPayoutStatementId] = useState<string|null>(null);
  const [payouts,setPayouts] = useState<Array<{id:string;amount:number;paid_on:string;payment_method:string;payment_reference:string;evidence_reference:string;recorded_by:string;recorded_at:string}>>([]);
  const [payoutBusy,setPayoutBusy] = useState(false);
  const [payoutReviews,setPayoutReviews]=useState<Array<{id:string;payout_id:string;status:string;reason:string;created_at:string;review_note:string|null}>>([]);
  const [reviewPayoutId,setReviewPayoutId]=useState<string|null>(null);
  const [reviewReason,setReviewReason]=useState('');
  const [adminReviewId,setAdminReviewId]=useState<string|null>(null);
  const [adminNote,setAdminNote]=useState('');

  const [payoutError,setPayoutError] = useState('');

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

  async function confirmIssue(statement:OwnerStatement) {
    if(!mayIssue||issuing||statement.status!=='DRAFT')return;
    if(!window.confirm('¿Confirmar emisión administrativa? Este acto no registra pago ni transferencia al propietario.'))return;
    setIssuing(true);setError('');
    try{
      const {error:issueError}=await supabase.rpc('admin_issue_owner_statement',{p_statement_id:statement.id,p_organization_id:organizationId});
      if(issueError)throw issueError;
      setRevision(value=>value+1);
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo confirmar la emisión.');}
    finally{setIssuing(false);}
  }

  async function loadPayouts(statementId:string){
    const {data,error:readError}=await supabase.from('owner_statement_payouts')
      .select('id,amount,paid_on,payment_method,payment_reference,evidence_reference,recorded_by,recorded_at')
      .eq('organization_id',organizationId).eq('statement_id',statementId)
      .order('recorded_at',{ascending:false});
    if(readError){setPayoutError('No fue posible consultar los abonos.');return;}
    setPayouts(data??[]);
    const {data:reviewData,error:reviewError}=await supabase.from('owner_payout_review_requests')
      .select('id,payout_id,status,reason,created_at,review_note')
      .eq('organization_id',organizationId).in('payout_id',(data??[]).map(item=>item.id));
    setPayoutReviews(reviewError?[]:reviewData??[]);
    setPayoutError(reviewError?'No fue posible consultar las solicitudes de revisión.':'');
  }
  async function decidePayoutReview(id:string,decision:'RESOLVED'|'REJECTED'){
    if(!mayIssue||payoutBusy||adminNote.trim().length<15)return;
    if(!window.confirm('Esta decisión no altera el desembolso registrado. ¿Continuar?'))return;
    setPayoutBusy(true);setPayoutError('');
    try{
      const {error}=await supabase.rpc('admin_decide_owner_payout_review',{
        p_organization_id:organizationId,p_review_id:id,p_decision:decision,p_note:adminNote.trim(),
      });
      if(error)throw error;
      setAdminReviewId(null);setAdminNote('');
      if(payoutStatementId)await loadPayouts(payoutStatementId);
    }catch(cause){setPayoutError(cause instanceof Error?cause.message:'Error al resolver solicitud.');}
    finally{setPayoutBusy(false);}
  }

  async function requestPayoutReview(payoutId:string){
    if(payoutBusy||reviewReason.trim().length<15)return;
    setPayoutBusy(true);setPayoutError('');
    try{
      const {error:reviewError}=await supabase.rpc('request_owner_payout_review',{
        p_organization_id:organizationId,p_payout_id:payoutId,p_reason:reviewReason.trim(),
      });
      if(reviewError)throw reviewError;
      setReviewPayoutId(null);setReviewReason('');
      if(payoutStatementId)await loadPayouts(payoutStatementId);
    }catch(cause){setPayoutError(cause instanceof Error?cause.message:'No se pudo solicitar revisión.');}
    finally{setPayoutBusy(false);}
  }

  async function openPayoutEvidence(statementId:string, reference:string){
    const prefix=organizationId+'/owner-payouts/'+statementId+'/';
    if(!reference.startsWith(prefix))return;
    const {data,error:linkError}=await supabase.storage.from('organization-documents').createSignedUrl(reference,60);
    if(linkError||!data?.signedUrl){setPayoutError('No se pudo abrir el soporte privado. Verifica el permiso de documentos.');return;}
    window.open(data.signedUrl,'_blank','noopener,noreferrer');
  }

  async function recordPayout(event:FormEvent<HTMLFormElement>, statement:OwnerStatement){
    event.preventDefault();
    if(!mayIssue||payoutBusy||statement.status!=='GENERATED')return;
    const formElement=event.currentTarget;
    const form=new FormData(formElement);
    const paidAmount=parseMoneyInput(String(form.get('amount')??''));
    const paidOn=String(form.get('paid_on')??'');
    const method=String(form.get('payment_method')??'');
    const reference=String(form.get('payment_reference')??'').trim();
    const input=formElement.elements.namedItem('evidence_file') as HTMLInputElement|null;
    const file=input?.files?.[0];
    if(!Number.isFinite(paidAmount)||paidAmount<=0||!/^\\d{4}-\\d{2}-\\d{2}$/.test(paidOn)||
       !['TRANSFER','CASH','CHECK','OTHER'].includes(method)||reference.length<5||!file){
      setPayoutError('Completa el importe, fecha, medio, referencia y adjunta un comprobante.');return;
    }
    const extension=file.type==='application/pdf'?'pdf':file.type==='image/jpeg'?'jpg':file.type==='image/png'?'png':null;
    if(!extension||file.size===0||file.size>5*1024*1024){
      setPayoutError('Adjunta un archivo JPG, PNG o PDF de hasta 5 MB.');return;
    }
    const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
    const valid=extension==='pdf'?[37,80,68,70,45].every((v,i)=>bytes[i]===v):
      extension==='png'?[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):
      bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(!valid){setPayoutError('El contenido no coincide con el formato JPG, PNG o PDF seleccionado.');return;}
    if(!window.confirm('Confirma que este dinero YA fue entregado al propietario. Se guardará el comprobante de forma privada. Este registro no realiza transferencias.'))return;
    setPayoutBusy(true);setPayoutError('');
    const path=organizationId+'/owner-payouts/'+statement.id+'/'+crypto.randomUUID()+'.'+extension;
    let uploaded=false;
    try{
      const {error:uploadError}=await supabase.storage.from('organization-documents').upload(path,file,{
        upsert:false,contentType:file.type,cacheControl:'0',
      });
      if(uploadError)throw new Error('No se pudo subir el comprobante: '+uploadError.message);
      uploaded=true;
      const {error:recordError}=await supabase.rpc('admin_record_owner_payout',{
        p_statement_id:statement.id,p_organization_id:organizationId,p_amount:paidAmount,
        p_paid_on:paidOn,p_payment_method:method,p_payment_reference:reference,p_evidence_reference:path,
      });
      if(recordError)throw recordError;
      uploaded=false; // Financial record now owns the private evidence file.
      formElement.reset();
      await loadPayouts(statement.id);
      setRevision(value=>value+1);
    }catch(cause){
      let cleanupNotice='';
      if(uploaded){
        const {error:cleanupError}=await supabase.storage.from('organization-documents').remove([path]);
        if(cleanupError)cleanupNotice=' Revisa con el administrador un archivo privado pendiente de limpieza.';
      }
      setPayoutError((cause instanceof Error?cause.message:'No se pudo registrar el abono.')+cleanupNotice);
    }finally{setPayoutBusy(false);}
  }

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
              <td className="py-2">{etiquetaES(statement.status)}{!reconciled && <div className="text-xs text-amber-800">Diferencia en liquidación</div>}</td>
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
                }}>Generar comprobante</button>
                {mayIssue&&statement.status==='DRAFT'&&<button type="button" disabled={issuing||!reconciled}
                  onClick={()=>void confirmIssue(statement)}
                  className="ml-2 rounded-lg border border-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-40">
                  Confirmar emisión
                </button>}
                <button type="button" className="ml-2 rounded-lg border px-3 py-1.5 text-xs font-semibold"
                  onClick={()=>{setPayoutStatementId(payoutStatementId===statement.id?null:statement.id);setPayoutError('');void loadPayouts(statement.id);}}>
                  {payoutStatementId===statement.id?'Ocultar pagos':'Consultar pagos'}
                </button></td>
            </tr>;
          })}</tbody>
        </table>
        {payoutStatementId&&statements.some(statement=>statement.id===payoutStatementId)&&(()=>{
          const selected=statements.find(statement=>statement.id===payoutStatementId)!;
          const paid=payouts.reduce((sum,p)=>sum+Number(p.amount),0);
          const balance=Number(selected.net_amount)-paid;
          return <section className="mt-4 rounded-xl border border-slate-200 p-4" aria-label="Pagos al propietario">
            <h3 className="font-semibold">Pagos y abonos al propietario</h3>
            <p className="text-sm text-slate-600">Registrado: {cop(paid)} · Saldo: {cop(balance)}. El registro no envía dinero.</p>
            {payoutError&&<p role="alert" className="my-2 text-sm text-red-700">{payoutError}</p>}
            {payouts.length>0&&<ul className="mt-2 space-y-1 text-sm">{payouts.map(p=><li key={p.id}>
              {p.paid_on} · {cop(Number(p.amount))} · {p.payment_method} · Referencia: {p.payment_reference}
              <span className="block text-xs text-slate-500">Registrado por: {p.recorded_by} · {new Date(p.recorded_at).toLocaleString('es-CO')}</span>
              {payoutReviews.filter(r=>r.payout_id===p.id).map(r=><div key={r.id} className="border-l-2 border-amber-300 pl-2 text-xs">
  Revisión: {etiquetaES(r.status)} · {r.reason}
  {r.review_note&&<p>Decisión: {r.review_note}</p>}
  {mayIssue&&r.status==='PENDING'&&(adminReviewId===r.id?
    <div><textarea aria-label="Justificación administrativa" value={adminNote} onChange={event=>setAdminNote(event.target.value)} minLength={15} maxLength={500} className="w-full border p-2"/>
      <button type="button" disabled={payoutBusy||adminNote.trim().length<15} onClick={()=>void decidePayoutReview(r.id,'RESOLVED')}>Aprobar revisión</button>
      <button type="button" disabled={payoutBusy||adminNote.trim().length<15} onClick={()=>void decidePayoutReview(r.id,'REJECTED')} className="ml-3">Rechazar</button>
      <button type="button" onClick={()=>setAdminReviewId(null)} className="ml-3">Cancelar</button>
    </div>:<button type="button" onClick={()=>{setAdminReviewId(r.id);setAdminNote('');}} className="underline">Resolver solicitud</button>)}
</div>)}
              {!payoutReviews.some(r=>r.payout_id===p.id&&r.status==='PENDING')&&
                <button type="button" className="mr-2 text-xs underline" onClick={()=>{setReviewPayoutId(p.id);setReviewReason('');}}>Solicitar corrección</button>}
              {reviewPayoutId===p.id&&<div className="my-2 space-y-1">
                <textarea aria-label="Motivo de revisión" placeholder="Explica el error (mínimo 15 caracteres)" value={reviewReason}
                  onChange={event=>setReviewReason(event.target.value)} minLength={15} maxLength={500}
                  className="w-full rounded-lg border p-2"/>
                <button type="button" disabled={payoutBusy||reviewReason.trim().length<15}
                  onClick={()=>void requestPayoutReview(p.id)} className="mr-2 rounded border p-1">Enviar revisión</button>
                <button type="button" onClick={()=>setReviewPayoutId(null)}>Cancelar</button>
              </div>}
              {p.evidence_reference.startsWith(organizationId+'/owner-payouts/'+selected.id+'/')?
              <button type="button" className="underline text-blue-700" onClick={()=>void openPayoutEvidence(selected.id,p.evidence_reference)}>Ver comprobante adjunto</button>:
              <span>Soporte: {p.evidence_reference}</span>}
            </li>)}</ul>}
            {mayIssue&&selected.status==='GENERATED'&&<form onSubmit={event=>void recordPayout(event,selected)} className="mt-3 grid gap-2 md:grid-cols-2">
              <p className="md:col-span-2 text-sm font-semibold">Registrar dinero ya entregado (no inicia pago)</p>
              <label className="text-sm">Importe COP<input name="amount" type="number" step="0.01" min="0.01" max={Math.max(0,balance)} required className="block w-full rounded-lg border p-2"/></label>
              <label className="text-sm">Fecha del pago<input name="paid_on" type="date" max={new Date().toISOString().slice(0,10)} required className="block w-full rounded-lg border p-2"/></label>
              <label className="text-sm">Medio<select name="payment_method" required className="block w-full rounded-lg border p-2">
                <option value="TRANSFER">Transferencia</option><option value="CASH">Efectivo</option><option value="CHECK">Cheque</option><option value="OTHER">Otro</option>
              </select></label>
              <label className="text-sm">Referencia del pago<input name="payment_reference" minLength={5} maxLength={140} required className="block w-full rounded-lg border p-2"/></label>
              <label className="text-sm md:col-span-2">Adjuntar foto o PDF del comprobante (máximo 5 MB)
                <input name="evidence_file" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" required className="block w-full rounded-lg border p-2"/>
                <span className="block text-xs text-slate-600">Archivo privado asociado al abono. Solo usuarios autorizados podrán consultarlo.</span>
              </label>
              <button disabled={payoutBusy||balance<=0} type="submit" className="rounded-lg border border-emerald-500 p-2 font-semibold text-emerald-800 disabled:opacity-40">Confirmar registro del abono</button>
            </form>}
          </section>;
        })()}
        <p className="mt-2 text-xs text-slate-600">Generar comprobante crea el documento para consulta; no cambia el estado de la liquidación ni confirma una transferencia bancaria al propietario.</p>
        {statements.length === 100 && <p className="mt-2 text-xs text-amber-800">Mostrando hasta 100 liquidaciones recientes.</p>}
      </div>}
  </section>;
}
