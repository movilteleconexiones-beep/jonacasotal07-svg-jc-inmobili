import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BadgeDollarSign, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { supabase } from '../../lib/supabase';

interface DealOption {
  id: string;
  stage: string;
  properties: { code: string; title: string } | null;
  contacts: { first_name: string; last_name: string | null } | null;
}

interface MemberOption {
  user_id: string;
}

interface CommissionRow {
  id: string;
  beneficiary_user_id: string | null;
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
  const organizationId = activeMembership?.organization.id;

  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(true);
  const loadVersion = useRef(0);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});

  async function load() {
    const version = ++loadVersion.current;
    if (!organizationId) {
      setRows([]); setDeals([]); setMembers([]); setProfileNames({}); setLoadingOptions(false);
      return;
    }
    setLoadingOptions(true);
    setRows([]); setDeals([]); setMembers([]); setProfileNames({});

    const [commissionsResult, dealsResult, membersResult] = await Promise.all([
      supabase
        .from('commissions')
        .select('id,beneficiary_user_id,commission_type,percentage,amount,currency,status,due_date,paid_at,notes,deals(properties!deals_property_id_fkey(code,title),contacts!deals_contact_id_fkey(first_name,last_name))')
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
    ]);

    if (version !== loadVersion.current) return;
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
    const percentage = String(form.get('percentage') ?? '').trim();
    const amount = String(form.get('amount') ?? '').trim();

    const { error } = await supabase.from('commissions').insert({
      organization_id: organizationId,
      deal_id: selectedDealId,
      beneficiary_user_id: beneficiaryId || null,
      commission_type: String(form.get('commission_type') ?? 'AGENT'),
      percentage: percentage ? Number(percentage) : null,
      amount: amount ? Number(amount) : null,
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
    formElement.reset();
    await load();
  }

  async function updateStatus(row: CommissionRow, status: string) {
    if (!organizationId || !can(PERMISSIONS.COMMISSIONS_EDIT) || row.status === status) return;
    if (!['PENDING','APPROVED','PAYABLE','PAID','CANCELLED'].includes(status)) return;
    if (status === 'PAID' && !window.confirm('¿Confirmas que esta comisión ya fue pagada? Cambiar el estado no realiza un pago bancario.')) return;
    const patch: Record<string, unknown> = { status };
    patch.paid_at = status === 'PAID' ? new Date().toISOString() : null;

    const { error } = await supabase.from('commissions').update(patch).eq('id', row.id).eq('organization_id', organizationId);
    if (error) setMessage(error.message);
    else await load();
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

          <Field name="percentage" label="Porcentaje %" type="number" min="0" step="0.01" />
          <Field name="amount" label={'Monto (' + (branding.currency || 'COP') + ')'} type="number" min="0" step="0.01" />
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

      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="px-4 py-3">Beneficiario</th>
              <th className="px-4 py-3">Negocio</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Monto</th>
              <th className="px-4 py-3">Estado</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-stone-100">
                <td className="px-4 py-3 font-semibold">
                  {row.beneficiary_user_id ? (profileNames[row.beneficiary_user_id] || row.beneficiary_user_id) : '—'}
                </td>
                <td className="px-4 py-3">
                  {row.deals?.properties?.code || '—'}
                  {row.deals?.contacts?.first_name ? ' · ' + row.deals.contacts.first_name : ''}
                </td>
                <td className="px-4 py-3">{row.commission_type}</td>
                <td className="px-4 py-3">{formatMoney(row.amount, row.currency)}</td>
                <td className="px-4 py-3">
                  {can(PERMISSIONS.COMMISSIONS_EDIT) ? (
                    <select
                      value={row.status}
                      onChange={(event) => void updateStatus(row, event.target.value)}
                      className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                    >
                      <option value="PENDING">Pendiente</option>
                      <option value="APPROVED">Aprobada</option>
                      <option value="PAYABLE">Por pagar</option>
                      <option value="PAID">Pagada</option>
                      <option value="CANCELLED">Cancelada</option>
                    </select>
                  ) : (
                    row.status
                  )}
                </td>
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  <BadgeDollarSign className="mx-auto mb-2 h-6 w-6" />
                  No hay comisiones registradas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
