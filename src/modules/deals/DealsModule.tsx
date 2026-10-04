import { useEffect, useState, type FormEvent } from 'react';
import { Handshake, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';

interface DealRow {
  id: string;
  stage: string;
  operation_type: string;
  asking_price: number | null;
  offered_price: number | null;
  final_price: number | null;
  commission_percentage: number | null;
  expected_close_date: string | null;
  contacts: { first_name: string; last_name: string | null } | null;
  properties: { code: string; title: string; currency: string } | null;
}

interface ContactOption { id: string; first_name: string; last_name: string | null }
interface PropertyOption { id: string; code: string; title: string; price: number | null; currency: string }

export function DealsModule() {
  const { user, activeMembership, can } = useAuth();
  const organizationId = activeMembership?.organization.id;
  const [rows, setRows] = useState<DealRow[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    if (!organizationId) return;
    const [dealResult, contactResult, propertyResult] = await Promise.all([
      supabase
        .from('deals')
        .select('id, stage, operation_type, asking_price, offered_price, final_price, commission_percentage, expected_close_date, contacts(first_name,last_name), properties(code,title,currency)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }),
      supabase.from('contacts').select('id, first_name, last_name').eq('organization_id', organizationId).order('first_name'),
      supabase.from('properties').select('id, code, title, price, currency').eq('organization_id', organizationId).order('created_at', { ascending: false }),
    ]);

    if (dealResult.error) setMessage(dealResult.error.message);
    else setRows((dealResult.data ?? []) as unknown as DealRow[]);
    if (!contactResult.error) setContacts((contactResult.data ?? []) as ContactOption[]);
    if (!propertyResult.error) setProperties((propertyResult.data ?? []) as PropertyOption[]);
  }

  useEffect(() => { void load(); }, [organizationId]);

  async function createDeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !user) return;
    const form = new FormData(event.currentTarget);
    const asking = String(form.get('asking_price') ?? '').trim();
    const offered = String(form.get('offered_price') ?? '').trim();
    const commission = String(form.get('commission_percentage') ?? '').trim();
    const closeDate = String(form.get('expected_close_date') ?? '').trim();

    const { error } = await supabase.from('deals').insert({
      organization_id: organizationId,
      contact_id: String(form.get('contact_id') ?? ''),
      property_id: String(form.get('property_id') ?? ''),
      assigned_agent_id: user.id,
      operation_type: String(form.get('operation_type') ?? 'SALE'),
      stage: 'INTEREST',
      asking_price: asking ? Number(asking) : null,
      offered_price: offered ? Number(offered) : null,
      commission_percentage: commission ? Number(commission) : null,
      expected_close_date: closeDate || null,
      created_by: user.id,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Negocio creado correctamente.');
    setShowCreate(false);
    event.currentTarget.reset();
    await load();
  }

  async function updateStage(id: string, stage: string) {
    const patch: Record<string, unknown> = { stage };
    if (stage === 'WON' || stage === 'LOST') patch.closed_at = new Date().toISOString();

    const { error } = await supabase.from('deals').update(patch).eq('id', id);
    if (error) setMessage(error.message);
    else await load();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Negocios</h1>
          <p className="mt-1 text-sm text-slate-600">Ofertas, negociaciones, cierres y comisiones.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold">
            <RefreshCw className="h-4 w-4" /> Actualizar
          </button>
          {can(PERMISSIONS.DEALS_CREATE) && (
            <button type="button" onClick={() => setShowCreate((v) => !v)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> Nuevo negocio
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createDeal} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
          <label>
            <span className="mb-1 block text-sm font-medium">Cliente *</span>
            <select name="contact_id" required className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="">Selecciona…</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{[contact.first_name, contact.last_name].filter(Boolean).join(' ')}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Propiedad *</span>
            <select name="property_id" required className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="">Selecciona…</option>
              {properties.map((property) => <option key={property.id} value={property.id}>{property.code} · {property.title}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Operación</span>
            <select name="operation_type" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="SALE">Venta</option>
              <option value="RENT">Arriendo</option>
            </select>
          </label>
          <Field name="expected_close_date" label="Cierre esperado" type="date" />
          <Field name="asking_price" label="Precio solicitado" type="number" min="0" />
          <Field name="offered_price" label="Oferta inicial" type="number" min="0" />
          <Field name="commission_percentage" label="Comisión %" type="number" min="0" step="0.01" />
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold">Cancelar</button>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Guardar negocio</button>
          </div>
        </form>
      )}

      {message && <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm">{message}</div>}

      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Propiedad</th>
              <th className="px-4 py-3">Etapa</th>
              <th className="px-4 py-3">Oferta</th>
              <th className="px-4 py-3">Cierre esperado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-stone-100">
                <td className="px-4 py-3 font-semibold">{[row.contacts?.first_name, row.contacts?.last_name].filter(Boolean).join(' ') || '—'}</td>
                <td className="px-4 py-3">{row.properties ? row.properties.code + ' · ' + row.properties.title : '—'}</td>
                <td className="px-4 py-3">
                  {can(PERMISSIONS.DEALS_EDIT) ? (
                    <select value={row.stage} onChange={(event) => void updateStage(row.id, event.target.value)} className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs">
                      {['INTEREST','VISIT','OFFER','NEGOTIATION','DOCUMENTATION','CLOSING','WON','LOST'].map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                    </select>
                  ) : row.stage}
                </td>
                <td className="px-4 py-3">{row.offered_price ?? '—'}</td>
                <td className="px-4 py-3">{row.expected_close_date || '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500"><Handshake className="mx-auto mb-2 h-6 w-6" />No hay negocios registrados.</td></tr>
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
