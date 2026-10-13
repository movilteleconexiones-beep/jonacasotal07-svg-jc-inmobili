import { etiquetaES } from '../../core/etiquetas-es';
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { BadgeDollarSign, Plus, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { supabase } from '../../lib/supabase';
import { parseMoneyInput } from '../../core/rent-owner-money';
import { commissionValueFromRate, parseCommissionPercentage } from '../../core/commission-percentage';

interface DealOption {
  id: string;
  stage: string;
  properties: { code: string; title: string } | null;
  contacts: { first_name: string; last_name: string | null } | null;
}

interface MemberOption {
  user_id: string;
}

interface CommissionReview {
  id: string;
  commission_id: string;
  requested_by: string;
  request_type: 'EDIT' | 'VOID';
  reason: string;
  proposed_values: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  review_reason: string | null;
  created_at: string;
}

interface CommissionRow {
  id: string;
  beneficiary_user_id: string | null;
  deal_id: string;
  calculation_basis: number | null;
  commission_type: string;
  percentage: number | null;
  amount: number | null;
  currency: string;
  status: string;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
  deals: {
    properties: { code: string; title: string } | null;
    contacts: { first_name: string; last_name: string | null } | null;
  } | null;
}

export function CommissionsModule() {
  const { activeMembership, can, user } = useAuth();
  const { branding } = useTenantBranding();
  const isCommissionAdministrator = activeMembership?.roles?.some(
    role => role.key === 'ADMIN' || role.key === 'ORGANIZATION_OWNER'
  ) ?? false;
  const organizationId = activeMembership?.organization.id;

  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId,setEditingId] = useState<string | null>(null);
  const [reviewTarget,setReviewTarget] = useState<{id:string;kind:'EDIT'|'VOID'} | null>(null);
  const [reviewRate,setReviewRate] = useState('');
  const [reviewBasis,setReviewBasis] = useState('');
  const [reviews,setReviews] = useState<CommissionReview[]>([]);
  const [corrections,setCorrections] = useState<Record<string,{corrected_amount:number;original_amount:number;difference_amount:number;archived_from_active:boolean}>>({});
  const [showArchived,setShowArchived] = useState(false);
  const [saving,setSaving] = useState(false);
  const [commissionRate,setCommissionRate] = useState('');
  const [commissionBasis,setCommissionBasis] = useState('');
  const ratePreview=parseCommissionPercentage(commissionRate);
  const basisPreview=parseMoneyInput(commissionBasis);
  const computedPreview=commissionValueFromRate(basisPreview,ratePreview);
  const [message, setMessage] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(true);
  const loadVersion = useRef(0);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});

  async function load() {
    const version = ++loadVersion.current;
    if (!organizationId) {
      setRows([]); setDeals([]); setMembers([]); setReviews([]); setCorrections({}); setProfileNames({}); setLoadingOptions(false);
      return;
    }
    setLoadingOptions(true);
    setRows([]); setDeals([]); setMembers([]); setReviews([]); setCorrections({}); setProfileNames({});

    const [commissionsResult, dealsResult, membersResult, reviewResult, correctionResult] = await Promise.all([
      supabase
        .from('commissions')
        .select('id,deal_id,beneficiary_user_id,commission_type,percentage,calculation_basis,amount,currency,status,due_date,paid_at,notes,deals(properties!deals_property_id_fkey(code,title),contacts!deals_contact_id_fkey(first_name,last_name))')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }),
      supabase
        .from('deals')
        .select('id,stage,properties!deals_property_id_fkey(code,title),contacts!deals_contact_id_fkey(first_name,last_name)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }),
      supabase
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', organizationId)
        .eq('status', 'ACTIVE'),
      supabase.from('commission_review_requests').select('id,commission_id,requested_by,request_type,reason,proposed_values,status,review_reason,created_at')
        .eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(100),
      supabase.from('commission_accounting_corrections').select('commission_id,original_amount,corrected_amount,difference_amount,archived_from_active').eq('organization_id',organizationId),
    ]);

    if (version !== loadVersion.current) return;
    setReviews(reviewResult.error?[]:((reviewResult.data??[]) as CommissionReview[]));
    if(correctionResult.error) setMessage('No se pudieron consultar las rectificaciones de comisiones.');
    setCorrections(Object.fromEntries((correctionResult.data??[]).map(item=>[item.commission_id,item])));
    if (commissionsResult.error) setMessage(commissionsResult.error.message);
    else setRows((commissionsResult.data ?? []) as unknown as CommissionRow[]);

    setDeals(dealsResult.error ? [] : ((dealsResult.data ?? []) as unknown as DealOption[]));
    if (dealsResult.error) setMessage('No fue posible cargar los negocios. Comprueba permisos y actualiza.');
    if (membersResult.error) { setMembers([]); setProfileNames({}); }
    if (!membersResult.error) {
      const memberRows = (membersResult.data ?? []) as unknown as MemberOption[];
      setMembers(memberRows);

      const userIds = memberRows.map((member) => member.user_id);
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id,full_name')
          .in('id', userIds);
        if (version !== loadVersion.current) return;

        const names: Record<string, string> = {};
        for (const profile of profiles ?? []) {
          names[profile.id] = profile.full_name || profile.id;
        }
        setProfileNames(names);
      } else {
        setProfileNames({});
      }
    }
    setLoadingOptions(false);
  }

  useEffect(() => {
    void load();
    return () => { ++loadVersion.current; };
  }, [organizationId]);

  async function createCommission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !user || !can(PERMISSIONS.COMMISSIONS_CREATE)) return;
    if (loadingOptions || deals.length === 0) {
      setMessage('Registra primero un negocio o actualiza la lista para crear una comisión.');
      return;
    }

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const selectedDealId = String(form.get('deal_id') ?? '');
    const beneficiaryId = String(form.get('beneficiary_user_id') ?? '');
    if (!deals.some((deal) => deal.id === selectedDealId) || (beneficiaryId && !members.some((member) => member.user_id === beneficiaryId))) {
      setMessage('El negocio o beneficiario seleccionado no está disponible. Actualiza y vuelve a intentarlo.');
      return;
    }
    const rate=parseCommissionPercentage(String(form.get('percentage') ?? ''));
    const basis=parseMoneyInput(String(form.get('calculation_basis') ?? ''));
    const amount=commissionValueFromRate(basis,rate);
    if (!Number.isFinite(rate)||!Number.isFinite(basis)||basis<=0||
        !Number.isFinite(amount)) {
      setMessage('Ingresa un porcentaje válido (0-100 %) y una base de cálculo positiva en COP. El importe de comisión se calcula automáticamente.');
      return;
    }

    const { error } = await supabase.from('commissions').insert({
      organization_id: organizationId,
      deal_id: selectedDealId,
      beneficiary_user_id: beneficiaryId || null,
      commission_type: String(form.get('commission_type') ?? 'AGENT'),
      percentage: rate,
      calculation_basis: basis,
      amount,
      currency: branding.currency || 'COP',
      status: 'PENDING',
      due_date: String(form.get('due_date') ?? '').trim() || null,
      notes: String(form.get('notes') ?? '').trim() || null,
      created_by: user.id,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Comisión creada correctamente.');
    setShowCreate(false);
    setCommissionRate('');setCommissionBasis('');
    formElement.reset();
    await load();
  }

  async function updateStatus(row: CommissionRow, status: string) {
    if (!organizationId || !can(PERMISSIONS.COMMISSIONS_EDIT) || row.status === status || saving) return;
    if (status==='CANCELLED') {
      if (!isCommissionAdministrator) {setMessage('Solo el administrador puede anular comisiones.');return;}
      if (corrections[row.id]) await archiveRectifiedCommission(row);
      else if (row.status==='PAID') {
        setReviewTarget({id:row.id,kind:'VOID'});
        setEditingId(null);
        setMessage('Para una comisión pagada, solicita revisión y confirma si hubo desembolso real.');
      } else await cancelCommission(row);
      return;
    }
    if (!['PENDING','APPROVED','PAYABLE','PAID'].includes(status)) return;
    if (status === 'PAID' && !isCommissionAdministrator) {
      setMessage('Solo un administrador puede registrar una comisión como pagada.');
      return;
    }
    const reason=window.prompt(status==='PAID'
      ?'Esta acción no realiza una transferencia bancaria. Indica referencia del comprobante o motivo (10 caracteres mínimo):'
      :'Indica el motivo del cambio de estado (10 caracteres mínimo):');
    if(reason===null) return;
    if(reason.trim().length<10 || reason.trim().length>500){
      setMessage('Es obligatorio justificar la operación con 10 a 500 caracteres.');return;
    }
    if(status==='PAID'&&!window.confirm('¿Confirmas con soporte que la comisión ya fue efectivamente pagada? Esta marca será inmutable y requerirá revisión administrativa para cualquier corrección.'))return;
    setSaving(true);setMessage('');
    try {
      const {error}=await supabase.rpc('set_commission_status_audited',{
        target_org:organizationId,target_commission:row.id,new_status:status,reason:reason.trim()
      });
      if(error){setMessage('No se pudo actualizar el estado: '+error.message);return;}
      setMessage('Estado actualizado con registro de auditoría. No se ejecutó ninguna transferencia bancaria.');
      await load();
    }finally{setSaving(false);}
  }

  async function editCommission(event: FormEvent<HTMLFormElement>, row: CommissionRow) {
    event.preventDefault();
    if (!organizationId || !can(PERMISSIONS.COMMISSIONS_EDIT) || saving) return;
    const f=new FormData(event.currentTarget);
    const rate=parseCommissionPercentage(String(f.get('percentage')??''));
    const basis=parseMoneyInput(String(f.get('calculation_basis')??''));
    const dealId=String(f.get('deal_id')??'');
    const beneficiary=String(f.get('beneficiary_user_id')??'')||null;
    const reason=String(f.get('reason')??'').trim();
    if(!Number.isFinite(rate)||basis===null||!Number.isFinite(basis)||basis<=0||
       reason.length<10||reason.length>500 ||
       !deals.some(d=>d.id===dealId) ||
       (beneficiary!==null&&!members.some(m=>m.user_id===beneficiary))){
      setMessage('Verifica la base, porcentaje, negocio y beneficiario; el motivo debe tener 10 a 500 caracteres.');
      return;
    }
    if(!window.confirm('¿Guardar la corrección auditada de esta comisión no pagada?'))return;
    setSaving(true);setMessage('');
    try {
      const {error}=await supabase.rpc('edit_unpaid_commission',{
        target_org:organizationId,target_commission:row.id,target_deal:dealId,
        target_beneficiary:beneficiary,target_type:String(f.get('commission_type')??'AGENT'),
        target_percentage:rate,target_basis:basis,
        target_due_date:String(f.get('due_date')??'')||null,
        target_notes:String(f.get('notes')??''),correction_reason:reason,
      });
      if(error){setMessage('No se pudo editar la comisión: '+error.message);return;}
      setEditingId(null);setMessage('Comisión corregida con auditoría de valores anteriores y nuevos.');
      await load();
    }finally{setSaving(false);}
  }

  async function cancelCommission(row:CommissionRow) {
    if(!organizationId||!isCommissionAdministrator||!can(PERMISSIONS.COMMISSIONS_EDIT)||saving)return;
    const reason=window.prompt('Indica el motivo de anulación (10 a 500 caracteres):');
    if(reason===null)return;
    if(reason.trim().length<10||reason.trim().length>500){
      setMessage('Describe el error y la razón de anulación (10 a 500 caracteres).');return;
    }
    if(!window.confirm('La comisión se marcará ANULADA sin borrar su historial. ¿Confirmas?'))return;
    setSaving(true);setMessage('');
    try{
      const {error}=await supabase.rpc('cancel_unpaid_commission',{
        target_org:organizationId,target_commission:row.id,reason:reason.trim()
      });
      if(error){setMessage('No se pudo anular: '+error.message);return;}
      setMessage('Comisión anulada sin eliminación física. Se conservó la auditoría.');
      setEditingId(null);await load();
    }finally{setSaving(false);}
  }

  async function requestPaidReview(event:FormEvent<HTMLFormElement>,row:CommissionRow,kind:'EDIT'|'VOID') {
    event.preventDefault();
    if(!organizationId||!can(PERMISSIONS.COMMISSIONS_EDIT)||saving||(kind==='VOID'&&!isCommissionAdministrator))return;
    const f=new FormData(event.currentTarget);
    const reason=String(f.get('reason')??'').trim();
    if(reason.length<15||reason.length>500){setMessage('Describe el error en 15 a 500 caracteres.');return;}
    const rate=kind==='EDIT'?parseCommissionPercentage(reviewRate):null;
    const basis=kind==='EDIT'?parseMoneyInput(reviewBasis):null;
    if(kind==='EDIT'&&(!Number.isFinite(rate)||basis===null||!Number.isFinite(basis)||basis<=0)){
      setMessage('Introduce el porcentaje y la base propuestos para la corrección.');return;
    }
    if(!window.confirm('¿Enviar solicitud para autorización administrativa? La comisión pagada no se modificará.'))return;
    setSaving(true);setMessage('');
    try{
      const {error}=await supabase.rpc('request_paid_commission_review',{
        target_org:organizationId,target_commission:row.id,kind,reason,
        proposed_percentage:rate,proposed_basis:basis
      });
      if(error){setMessage('No se pudo registrar la solicitud: '+error.message);return;}
      setReviewTarget(null);
      setMessage('Solicitud registrada y pendiente de autorización por otro administrador. El pago histórico permanece intacto.');
      await load();
    }finally{setSaving(false);}
  }

  async function decideReview(review:CommissionReview,decision:'APPROVED'|'REJECTED') {
    if(!organizationId||!isCommissionAdministrator||saving)return;
    const reason=window.prompt(decision==='APPROVED'
      ?'Indica la autorización y cómo se documentará el ajuste compensatorio (mínimo 10 caracteres):'
      :'Indica el motivo del rechazo (mínimo 10 caracteres):');
    if(reason===null)return;
    if(reason.trim().length<10||reason.trim().length>500){
      setMessage('La decisión requiere una justificación de 10 a 500 caracteres.');return;
    }
    if(!window.confirm('¿Confirmar decisión? La autorización NO altera el pago original: requiere un ajuste contable separado.'))return;
    setSaving(true);setMessage('');
    try{
      const {error}=await supabase.rpc('decide_paid_commission_review',{
        target_org:organizationId,target_request:review.id,decision,reason:reason.trim()
      });
      if(error){setMessage('No fue posible resolver la solicitud: '+error.message);return;}
      setMessage(decision==='APPROVED'
        ?'Revisión autorizada. Debe registrarse un ajuste compensatorio; la comisión pagada original permanece sin cambios.'
        :'Solicitud rechazada con auditoría.');
      await load();
    }finally{setSaving(false);}
  }

  async function acceptErroneousPaidCommission(review:CommissionReview) {
    if(!organizationId||!isCommissionAdministrator||!can(PERMISSIONS.COMMISSIONS_EDIT)||saving)return;
    const reason=window.prompt('Motivo de aceptación/anulación (20-500 caracteres). Confirma que el importe se marcó como pagado por error y que NO hubo entrega de dinero:');
    if(reason===null)return;
    if(reason.trim().length<20||reason.trim().length>500){setMessage('Debes justificar la decisión en 20 a 500 caracteres.');return;}
    if(!window.confirm('CONFIRMO QUE NO HUBO DESEMBOLSO REAL. ¿Aceptar la solicitud y realizar la anulación/rectificación contable, conservando el movimiento original en auditoría?'))return;
    setSaving(true);setMessage('');
    try {
      const {error}=await supabase.rpc('accept_erroneous_paid_commission_review',{
        target_org:organizationId,target_request:review.id,confirmation_no_disbursement:true,approval_reason:reason.trim()
      });
      if(error){setMessage('No se pudo aceptar la solicitud: '+error.message);return;}
      setMessage('Solicitud autorizada y resuelta con auditoría. Se conserva el histórico y se muestra la rectificación.');
      await load();
    }catch{setMessage('No se confirmó la autorización. Actualiza la lista antes de volver a intentarlo.');}
    finally{setSaving(false);}
  }

  async function restoreCancelledCommission(row:CommissionRow) {
    if(!organizationId||!isCommissionAdministrator||!can(PERMISSIONS.COMMISSIONS_EDIT)||saving||row.status!=='CANCELLED')return;
    const reason=window.prompt('Motivo de recuperación (mínimo 15 caracteres):');
    if(reason===null)return;
    if(reason.trim().length<15||reason.trim().length>500){setMessage('El motivo debe tener entre 15 y 500 caracteres.');return;}
    if(!window.confirm('¿Restaurar esta comisión anulada al estado PENDIENTE? La anulación permanecerá en la auditoría.'))return;
    setSaving(true);setMessage('');
    try {
      const {error}=await supabase.rpc('restore_cancelled_commission',{
        target_org:organizationId,target_commission:row.id,correction_reason:reason.trim()
      });
      if(error){setMessage('No se pudo restaurar: '+error.message);return;}
      setMessage('Comisión recuperada en estado pendiente, con auditoría.');
      await load();
    }catch{setMessage('No se confirmó la recuperación. Actualiza y revisa el estado.');}
    finally{setSaving(false);}
  }

  async function archiveRectifiedCommission(row:CommissionRow) {
    if(!organizationId||!isCommissionAdministrator||!can(PERMISSIONS.COMMISSIONS_EDIT)||saving||!corrections[row.id]||corrections[row.id].archived_from_active)return;
    const reason=window.prompt('Motivo para retirar esta comisión rectificada del listado activo (15 a 500 caracteres):');
    if(reason===null)return;
    if(reason.trim().length<15||reason.trim().length>500){setMessage('Explica el motivo en 15 a 500 caracteres; indica el error y por qué se retira.');return;}
    if(!window.confirm('¿Retirar esta comisión del listado operativo? El registro original y su rectificación seguirán disponibles en el historial y auditoría.'))return;
    setSaving(true);setMessage('');
    try {
      const {error}=await supabase.rpc('archive_rectified_commission',{target_org:organizationId,target_commission:row.id,reason:reason.trim()});
      if(error){setMessage('No se pudo retirar la comisión: '+error.message);return;}
      setMessage('Comisión retirada del listado activo. Puedes registrar una nueva; el historial se conserva.');
      await load();
    }catch{setMessage('No se confirmó el archivo. Actualiza la lista antes de reintentar.');}
    finally{setSaving(false);}
  }

  const formatMoney = (amount: number | null, currency: string) =>
    amount == null
      ? '—'
      : new Intl.NumberFormat(branding.locale || 'es-CO', {
          style: 'currency',
          currency: currency || branding.currency || 'COP',
          maximumFractionDigits: 0,
        }).format(amount);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Comisiones</h1>
          <p className="mt-1 text-sm text-slate-600">
            Controla comisiones de asesores, captadores, coordinadores y referidos.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold"
          >
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </button>

          {can(PERMISSIONS.COMMISSIONS_CREATE) && (
            <button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              Nueva comisión
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createCommission} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
          {loadingOptions && <p role="status" className="md:col-span-2 text-sm text-slate-600">Cargando negocios disponibles…</p>}
          {!loadingOptions && deals.length === 0 && <p role="alert" className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Todavía no hay negocios disponibles. Primero crea un negocio en la sección Negocios; después podrás registrar sus comisiones.</p>}
          <label>
            <span className="mb-1 block text-sm font-medium">Negocio *</span>
            <select name="deal_id" required className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="">Selecciona…</option>
              {deals.map((deal) => (
                <option key={deal.id} value={deal.id}>
                  {(deal.properties?.code || 'Sin código') + ' · ' + (deal.contacts?.first_name || 'Cliente')}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1 block text-sm font-medium">Beneficiario</span>
            <select name="beneficiary_user_id" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="">Sin usuario específico</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {profileNames[member.user_id] || member.user_id}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="mb-1 block text-sm font-medium">Tipo</span>
            <select name="commission_type" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="AGENT">Asesor</option>
              <option value="CAPTOR">Captador</option>
              <option value="COORDINATOR">Coordinador</option>
              <option value="REFERRAL">Referido</option>
              <option value="COMPANY">Inmobiliaria</option>
              <option value="OTHER">Otro</option>
            </select>
          </label>

          <label>
            <span className="mb-1 block text-sm font-medium">Porcentaje de comisión (%) *</span>
            <input name="percentage" type="number" min="0" max="100" step="0.01" required
              value={commissionRate} onChange={event=>setCommissionRate(event.target.value)}
              className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">
              Base sobre la que se aplica el porcentaje ({branding.currency || 'COP'}) *
            </span>
            <input name="calculation_basis" type="number" min="0.01" step="0.01" required
              value={commissionBasis} onChange={event=>setCommissionBasis(event.target.value)}
              className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
          </label>
          <p className="md:col-span-2 text-sm text-slate-700">
            Comisión calculada: <strong>{Number.isFinite(computedPreview)
              ?formatMoney(computedPreview,branding.currency || 'COP'):'Ingresa el porcentaje y la base'}</strong>.
            La base puede ser el canon mensual, precio pactado o comisión inmobiliaria,
            según el acuerdo con el beneficiario. No se introduce el importe de comisión manualmente.
          </p>
          <Field name="due_date" label="Fecha de pago esperada" type="date" />

          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium">Notas</span>
            <textarea name="notes" rows={3} className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
          </label>

          <div className="md:col-span-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold"
            >
              Cancelar
            </button>
            <button type="submit" disabled={loadingOptions || deals.length === 0} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
              Guardar comisión
            </button>
          </div>
        </form>
      )}

      {message && <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm">{message}</div>}

      <div className="flex items-center justify-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/> Mostrar comisiones retiradas (historial)</label></div>
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="px-4 py-3">Beneficiario</th>
              <th className="px-4 py-3">Negocio</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Porcentaje</th>
              <th className="px-4 py-3">Monto calculado (COP)</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Acciones</th>
            </tr>
          </thead>

          <tbody>
            {rows.filter(row=>showArchived||!corrections[row.id]?.archived_from_active).map((row) => (
              <Fragment key={row.id}><tr className="border-t border-stone-100">
                <td className="px-4 py-3 font-semibold">
                  {row.beneficiary_user_id ? (profileNames[row.beneficiary_user_id] || row.beneficiary_user_id) : '—'}
                </td>
                <td className="px-4 py-3">
                  {row.deals?.properties?.code || '—'}
                  {row.deals?.contacts?.first_name ? ' · ' + row.deals.contacts.first_name : ''}
                </td>
                <td className="px-4 py-3">{etiquetaES(row.commission_type)}</td>
                <td className="px-4 py-3">{row.percentage==null?'—':`${Number(row.percentage).toLocaleString('es-CO',{maximumFractionDigits:2})} %`}</td>
                <td className="px-4 py-3">{corrections[row.id] ? <div><strong>{formatMoney(corrections[row.id].corrected_amount,row.currency)}</strong><div className="text-xs text-amber-800">Rectificada · Original {formatMoney(corrections[row.id].original_amount,row.currency)} · Diferencia {formatMoney(corrections[row.id].difference_amount,row.currency)}</div></div> : formatMoney(row.amount, row.currency)}</td>
                <td className="px-4 py-3">
                  {can(PERMISSIONS.COMMISSIONS_EDIT) && row.status !== 'CANCELLED' && (row.status !== 'PAID' || (isCommissionAdministrator && !!corrections[row.id] && !corrections[row.id].archived_from_active)) ? (
                    <select
                      value={row.status}
                      onChange={(event) => void updateStatus(row, event.target.value)}
                      disabled={saving || !isCommissionAdministrator}
                      className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                    >
                      <option value="PENDING">Pendiente</option>
                      <option value="APPROVED">Aprobada</option>
                      <option value="PAYABLE">Por pagar</option>
                      <option value="PAID">Pagada</option>
                      {isCommissionAdministrator&&<option value="CANCELLED">Anular {corrections[row.id] ? "(retirar del listado)" : ""}</option>}

                    </select>
                  ) : (
                    corrections[row.id] ? 'Rectificada (pago registrado por error)' : etiquetaES(row.status)
                  )}
                </td>
                <td className="px-4 py-3">
                  {isCommissionAdministrator && row.status==='CANCELLED' &&
                    <button type="button" disabled={saving} onClick={()=>void restoreCancelledCommission(row)}
                    className="rounded-lg border border-emerald-300 px-2 py-1.5 text-xs text-emerald-800">Recuperar</button>}
                  {isCommissionAdministrator && corrections[row.id] && !corrections[row.id].archived_from_active &&
                    <button type="button" disabled={saving} onClick={()=>void archiveRectifiedCommission(row)}
                    className="rounded-lg border border-red-300 px-2 py-1.5 text-xs text-red-700">Retirar del listado</button>}
                  {corrections[row.id]?.archived_from_active && <span className="text-xs text-slate-500">Retirada · historial conservado</span>}
                   {can(PERMISSIONS.COMMISSIONS_EDIT) && <div className="flex flex-wrap gap-2">
                    {row.status !== 'CANCELLED' && !corrections[row.id] && <button type="button" disabled={saving}
                      onClick={()=>{
                        if(row.status==='PAID'){
                          setReviewTarget({id:row.id,kind:'EDIT'});
                          setReviewRate(row.percentage==null?'':String(row.percentage));
                          setReviewBasis(row.calculation_basis==null?'':String(row.calculation_basis));
                          setEditingId(null);
                        }else{
                          setEditingId(editingId===row.id?null:row.id);setReviewTarget(null);
                        }
                        setMessage('');
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-semibold">
                      <Pencil className="h-3.5 w-3.5"/> {row.status==='PAID'?'Solicitar edición':'Editar'}
                    </button>}
                    {isCommissionAdministrator && row.status !== 'CANCELLED' && !corrections[row.id]&&<button type="button" disabled={saving}
                      onClick={()=>{
                        if(row.status==='PAID'){setReviewTarget({id:row.id,kind:'VOID'});setEditingId(null);setMessage('');}
                        else void cancelCommission(row);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-700">
                      <Trash2 className="h-3.5 w-3.5"/> {row.status==='PAID'?'Solicitar anulación':'Anular'}
                    </button>}
                  </div>}
                </td>
              </tr>
              {editingId===row.id&&row.status!=='PAID'&&row.status!=='CANCELLED'&&<tr>
                <td colSpan={7} className="border-t bg-slate-50 p-4">
                  <form onSubmit={event=>void editCommission(event,row)} className="grid gap-3 md:grid-cols-2">
                    <h3 className="md:col-span-2 font-semibold">Editar comisión no pagada</h3>
                    <label className="text-sm">Negocio
                      <select name="deal_id" required defaultValue={row.deal_id} className="mt-1 block w-full rounded-lg border p-2">
                        {deals.map(d=><option key={d.id} value={d.id}>{d.properties?.code||'Negocio'} · {d.contacts?.first_name||'Cliente'}</option>)}
                      </select>
                    </label>
                    <label className="text-sm">Beneficiario
                      <select name="beneficiary_user_id" defaultValue={row.beneficiary_user_id||''} className="mt-1 block w-full rounded-lg border p-2">
                        <option value="">Sin usuario específico</option>
                        {members.map(m=><option key={m.user_id} value={m.user_id}>{profileNames[m.user_id]||m.user_id}</option>)}
                      </select>
                    </label>
                    <label className="text-sm">Tipo de comisión
                      <select name="commission_type" defaultValue={row.commission_type} className="mt-1 block w-full rounded-lg border p-2">
                        {['AGENT','CAPTOR','COORDINATOR','REFERRAL','COMPANY','OTHER'].map(code=>
                          <option value={code} key={code}>{etiquetaES(code)}</option>)}
                      </select>
                    </label>
                    <label className="text-sm">Porcentaje (%)
                      <input name="percentage" type="number" min="0" max="100" step="0.01" required
                        defaultValue={row.percentage??''} className="mt-1 block w-full rounded-lg border p-2"/>
                    </label>
                    <label className="text-sm">Base de cálculo (COP)
                      <input name="calculation_basis" type="number" min="0.01" step="0.01" required
                        defaultValue={row.calculation_basis??''}
                        placeholder={row.calculation_basis==null?'Registrar base original no documentada':undefined}
                        className="mt-1 block w-full rounded-lg border p-2"/>
                    </label>
                    <label className="text-sm">Fecha de pago esperada
                      <input type="date" name="due_date" defaultValue={row.due_date??''} className="mt-1 block w-full rounded-lg border p-2"/>
                    </label>
                    <label className="text-sm md:col-span-2">Notas
                      <textarea name="notes" defaultValue={row.notes??''} maxLength={2000} className="mt-1 block w-full rounded-lg border p-2"/>
                    </label>
                    <label className="text-sm md:col-span-2">Motivo de la corrección (obligatorio)
                      <textarea name="reason" minLength={10} maxLength={500} required className="mt-1 block w-full rounded-lg border p-2"/>
                    </label>
                    <div className="md:col-span-2 flex justify-end gap-2">
                      <button type="button" disabled={saving} onClick={()=>setEditingId(null)} className="rounded-lg border px-3 py-2">Cancelar</button>
                      <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Guardar corrección</button>
                    </div>
                  </form>
                </td>
              </tr>}
              {reviewTarget?.id===row.id && row.status==='PAID'&&<tr>
                <td colSpan={7} className="border-t bg-amber-50 p-4">
                  <form onSubmit={event=>void requestPaidReview(event,row,reviewTarget.kind)} className="grid gap-3 md:grid-cols-2">
                    <h3 className="md:col-span-2 font-semibold">Solicitud de {reviewTarget.kind==='EDIT'?'corrección':'anulación'} de comisión pagada</h3>
                    <p className="md:col-span-2 text-sm">
                      Por seguridad, se conserva el pago histórico; la solicitud requiere aprobación
                      de un administrador distinto del solicitante y un ajuste contable posterior.
                    </p>
                    {reviewTarget.kind==='EDIT'&&<>
                      <label className="text-sm">Nuevo porcentaje (%)
                        <input required type="number" min="0" max="100" step="0.01" value={reviewRate}
                          onChange={e=>setReviewRate(e.target.value)} className="mt-1 block w-full rounded-lg border p-2"/>
                      </label>
                      <label className="text-sm">Nueva base de cálculo (COP)
                        <input required type="number" min="0.01" step="0.01" value={reviewBasis}
                          onChange={e=>setReviewBasis(e.target.value)} className="mt-1 block w-full rounded-lg border p-2"/>
                      </label>
                    </>}
                    <label className="md:col-span-2 text-sm">Motivo y soporte para revisión administrativa
                      <textarea name="reason" minLength={15} maxLength={500} required className="mt-1 block w-full rounded-lg border p-2"/>
                    </label>
                    <div className="md:col-span-2 flex justify-end gap-2">
                      <button type="button" disabled={saving} onClick={()=>setReviewTarget(null)} className="rounded-lg border px-3 py-2">Cancelar</button>
                      <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50">Enviar solicitud</button>
                    </div>
                  </form>
                </td>
              </tr>}
              </Fragment>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  <BadgeDollarSign className="mx-auto mb-2 h-6 w-6" />
                  No hay comisiones registradas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {reviews.length>0&&<section className="rounded-2xl border bg-white p-4">
        <h2 className="font-semibold">Solicitudes de corrección sobre comisiones pagadas</h2>
        <p className="mb-3 text-xs text-slate-600">La aprobación autoriza la revisión contable, no modifica ni borra el pago original.</p>
        <div className="space-y-2">{reviews.map(review=><div key={review.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
          <div><strong>{review.request_type==='EDIT'?'Corrección':'Anulación solicitada'}</strong>
            <span className="ml-2">{corrections[review.commission_id] ? 'Rectificada contablemente' : etiquetaES(review.status)}</span>
            <div className="text-xs text-slate-600">{review.reason}</div>
            {corrections[review.commission_id]&&<div className="text-xs text-green-800">Rectificación contable registrada: {formatMoney(corrections[review.commission_id].corrected_amount,'COP')} (sin desembolso real).</div>}
            {review.review_reason&&<div className="text-xs text-slate-600">Decisión: {review.review_reason}</div>}
          </div>
          {isCommissionAdministrator && review.status==='PENDING' &&
            <button type="button" disabled={saving} onClick={()=>void acceptErroneousPaidCommission(review)}
              className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-amber-900">
              {corrections[review.commission_id] ? 'Aceptar y cerrar rectificación' : 'Aceptar y anular comisión (sin desembolso)'}
            </button>}
          {isCommissionAdministrator && review.status==='PENDING' && !corrections[review.commission_id] && review.requested_by!==user?.id&&
            <div className="flex gap-2">
              <button type="button" disabled={saving} onClick={()=>void decideReview(review,'APPROVED')}
                className="rounded-lg border px-3 py-2">Autorizar revisión</button>
              <button type="button" disabled={saving} onClick={()=>void decideReview(review,'REJECTED')}
                className="rounded-lg border border-red-300 px-3 py-2 text-red-700">Rechazar</button>
            </div>}
          </div>)}</div>
      </section>}
    </section>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...inputProps } = props;
  return (
    <label>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input {...inputProps} className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
    </label>
  );
}
