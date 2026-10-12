import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { Handshake, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';

interface DealRow {
  id: string;
  contact_id: string;
  property_id: string;
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(true);
  const loadVersion = useRef(0);
  const hasRequiredOptions = contacts.length > 0 && properties.length > 0;
  const isAgencyAdministrator = activeMembership?.roles.some(role => role.key === 'ADMIN') ?? false;
  const mayDelete = isAgencyAdministrator && can(PERMISSIONS.DEALS_CLOSE);

  async function load() {
    const version = ++loadVersion.current;
    setRows([]); setContacts([]); setProperties([]);
    if (!organizationId) { setLoadingOptions(false); return; }
    setLoadingOptions(true);
    setMessage('');
    try {
      const [dealResult, contactResult, propertyResult] = await Promise.all([
        supabase
          .from('deals')
          .select('id, contact_id, property_id, stage, operation_type, asking_price, offered_price, final_price, commission_percentage, expected_close_date, contacts!deals_contact_id_fkey(first_name,last_name), properties!deals_property_id_fkey(code,title,currency)')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false }),
        supabase.from('contacts').select('id, first_name, last_name').eq('organization_id', organizationId).order('first_name'),
        supabase.from('properties').select('id, code, title, price, currency').eq('organization_id', organizationId).order('created_at', { ascending: false }),
      ]);

      if (version !== loadVersion.current) return;
      if (dealResult.error) setMessage('No se pudieron consultar los negocios. Verifica tus permisos.');
      else setRows((dealResult.data ?? []) as unknown as DealRow[]);
      setContacts(contactResult.error ? [] : ((contactResult.data ?? []) as ContactOption[]));
      setProperties(propertyResult.error ? [] : ((propertyResult.data ?? []) as PropertyOption[]));
      if (contactResult.error || propertyResult.error) {
        setMessage('No se pudieron consultar clientes o propiedades. Actualiza antes de crear un negocio.');
      }
    } catch {
      if (version !== loadVersion.current) return;
      setMessage('No se pudieron consultar los datos del negocio. Intenta actualizar.');
    } finally {
      if (version === loadVersion.current) setLoadingOptions(false);
    }
  }

  useEffect(() => {
    void load();
    return () => { ++loadVersion.current; };
  }, [organizationId]);

  async function createDeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !user || !can(PERMISSIONS.DEALS_CREATE)) return;
    if (!hasRequiredOptions || loadingOptions) {
      setMessage('Primero registra al menos un cliente y una propiedad, o actualiza la lista.');
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const contactId = String(form.get('contact_id') ?? '');
    const propertyId = String(form.get('property_id') ?? '');
    if (!contacts.some((item) => item.id === contactId) || !properties.some((item) => item.id === propertyId)) {
      setMessage('El cliente o la propiedad seleccionados ya no están disponibles. Actualiza antes de continuar.');
      return;
    }
    const asking = String(form.get('asking_price') ?? '').trim();
    const offered = String(form.get('offered_price') ?? '').trim();
    const commission = String(form.get('commission_percentage') ?? '').trim();
    const closeDate = String(form.get('expected_close_date') ?? '').trim();

    if (busy) return;
    setBusy(true);
    let errorMessage = '';
    try {
    const { error } = await supabase.from('deals').insert({
      organization_id: organizationId,
      contact_id: contactId,
      property_id: propertyId,
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
      errorMessage = error.message;
      return;
    }

    setShowCreate(false);
    formElement.reset();
    await load();
    setMessage('Negocio creado correctamente.');
    } catch {
      errorMessage = 'No se confirmó la creación del negocio. Actualiza el listado antes de volver a intentarlo.';
    } finally {
      setBusy(false);
      if (errorMessage) setMessage(errorMessage);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, row: DealRow) {
    event.preventDefault();
    if (!organizationId || !can(PERMISSIONS.DEALS_EDIT) || busy) return;
    const form = new FormData(event.currentTarget);
    const contactId = String(form.get('contact_id') ?? '');
    const propertyId = String(form.get('property_id') ?? '');
    const operation = String(form.get('operation_type') ?? '');
    const closeDate = String(form.get('expected_close_date') ?? '');
    if (!contacts.some(item => item.id === contactId) ||
        !properties.some(item => item.id === propertyId) ||
        !['SALE', 'RENT'].includes(operation) ||
        (closeDate && !/^\\d{4}-\\d{2}-\\d{2}$/.test(closeDate))) {
      setMessage('Verifica cliente, inmueble, operación y fecha de cierre.');
      return;
    }

    const amounts: Record<string, number | null> = {};
    for (const field of ['asking_price', 'offered_price', 'final_price', 'commission_percentage']) {
      const raw = String(form.get(field) ?? '').trim();
      const value = raw ? Number(raw) : null;
      if (value !== null && (!Number.isFinite(value) || value < 0 ||
          (field === 'commission_percentage' && value > 100))) {
        setMessage('Los importes no pueden ser negativos y la comisión debe estar entre 0 % y 100 %.');
        return;
      }
      amounts[field] = value;
    }
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabase.from('deals').update({
        contact_id: contactId,
        property_id: propertyId,
        operation_type: operation,
        expected_close_date: closeDate || null,
        ...amounts,
        updated_at: new Date().toISOString(),
      }).eq('organization_id', organizationId).eq('id', row.id)
        .select('id').maybeSingle();
      if (error || !data) {
        setMessage('No se guardaron los cambios: ' +
          (error?.message ?? 'El negocio no existe o no tienes permiso para modificarlo.'));
        return;
      }
      setEditingId(null);
      await load();
      setMessage('Negocio actualizado correctamente.');
    } catch {
      setMessage('No se confirmó la edición. Actualiza antes de repetirla.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteDeal(row: DealRow) {
    if (!organizationId || !mayDelete || busy) return;
    if (!window.confirm('¿Eliminar definitivamente este negocio? Solo se permite si está abierto y no tiene actividades ni comisiones asociadas. Esta acción se auditará y no se puede deshacer.')) return;
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabase.rpc('delete_unlinked_deal', {
        target_org: organizationId, target_deal: row.id,
      });
      if (error) {
        setMessage('No se pudo eliminar: ' + error.message);
        return;
      }
      if (!data) {
        setMessage('El negocio ya no existe. Actualiza la tabla.');
        return;
      }
      setEditingId(null);
      await load();
      setMessage('Negocio eliminado y operación registrada en auditoría.');
    } catch {
      setMessage('No se confirmó la eliminación. Actualiza la lista antes de reintentar.');
    } finally {
      setBusy(false);
    }
  }

  async function updateStage(id: string, stage: string) {
    if (!organizationId || !can(PERMISSIONS.DEALS_EDIT) || busy) return;
    if (!['INTEREST','VISIT','OFFER','NEGOTIATION','DOCUMENTATION','CLOSING','WON','LOST'].includes(stage)) return;
    const patch: Record<string, unknown> = { stage };
    patch.closed_at = stage === 'WON' || stage === 'LOST' ? new Date().toISOString() : null;

    setBusy(true);
    try {
      const {data,error} = await supabase.from('deals').update(patch)
        .eq('id',id).eq('organization_id',organizationId).select('id').maybeSingle();
      if (error || !data) setMessage(error?.message ?? 'El negocio no existe o ya no está autorizado.');
      else await load();
    } catch {
      setMessage('No se confirmó el cambio de etapa. Actualiza antes de reintentar.');
    } finally {
      setBusy(false);
    }
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
            <button type="button" onClick={() => {setEditingId(null);setShowCreate((v) => !v);}} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> Nuevo negocio
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createDeal} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
          {!loadingOptions && !hasRequiredOptions && (
            <p role="alert" className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Para registrar un negocio necesitas al menos un cliente y una propiedad de esta inmobiliaria.
              {contacts.length === 0 ? ' Falta registrar un cliente en Clientes.' : ''}
              {properties.length === 0 ? ' Falta registrar una propiedad en Propiedades.' : ''}
            </p>
          )}
          {loadingOptions && <p role="status" className="md:col-span-2 text-sm text-slate-600">Cargando clientes y propiedades…</p>}
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
            <button type="submit" disabled={!hasRequiredOptions || loadingOptions || busy} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Guardar negocio</button>
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
              <th className="px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
              <tr className="border-t border-stone-100">
                <td className="px-4 py-3 font-semibold">{[row.contacts?.first_name, row.contacts?.last_name].filter(Boolean).join(' ') || '—'}</td>
                <td className="px-4 py-3">{row.properties ? row.properties.code + ' · ' + row.properties.title : '—'}</td>
                <td className="px-4 py-3">
                  {can(PERMISSIONS.DEALS_EDIT) ? (
                    <select value={row.stage} disabled={busy} onChange={(event) => void updateStage(row.id, event.target.value)} className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs">
                      {['INTEREST','VISIT','OFFER','NEGOTIATION','DOCUMENTATION','CLOSING','WON','LOST'].map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                    </select>
                  ) : row.stage}
                </td>
                <td className="px-4 py-3">{row.offered_price ?? '—'}</td>
                <td className="px-4 py-3">{row.expected_close_date || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {can(PERMISSIONS.DEALS_EDIT) && <button type="button" disabled={busy}
                      onClick={() => {setEditingId(editingId === row.id ? null : row.id);setShowCreate(false);setMessage('');}}
                      className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                      <Pencil className="h-3.5 w-3.5" /> Editar
                    </button>}
                    {mayDelete && <button type="button" disabled={busy}
                      onClick={() => void deleteDeal(row)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-800 disabled:opacity-50">
                      <Trash2 className="h-3.5 w-3.5" /> Eliminar
                    </button>}
                  </div>
                </td>
              </tr>
              {editingId === row.id && <tr className="border-t border-stone-200 bg-stone-50">
                <td colSpan={6} className="p-4">
                  <form onSubmit={event => void saveEdit(event, row)}
                    className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 md:grid-cols-2">
                    <h3 className="md:col-span-2 text-base font-bold">Editar negocio</h3>
                    <label className="text-sm">Cliente
                      <select name="contact_id" required defaultValue={row.contact_id}
                        className="mt-1 w-full rounded-lg border p-2">
                        {contacts.map(c => <option key={c.id} value={c.id}>
                          {[c.first_name,c.last_name].filter(Boolean).join(' ')}
                        </option>)}
                      </select>
                    </label>
                    <label className="text-sm">Propiedad
                      <select name="property_id" required defaultValue={row.property_id}
                        className="mt-1 w-full rounded-lg border p-2">
                        {properties.map(p => <option key={p.id} value={p.id}>
                          {p.code} · {p.title}
                        </option>)}
                      </select>
                    </label>
                    <label className="text-sm">Operación
                      <select name="operation_type" defaultValue={row.operation_type}
                        className="mt-1 w-full rounded-lg border p-2">
                        <option value="SALE">Venta</option><option value="RENT">Arriendo</option>
                      </select>
                    </label>
                    <Field name="expected_close_date" label="Cierre esperado" type="date"
                      defaultValue={row.expected_close_date ?? ''} />
                    <Field name="asking_price" label="Precio solicitado" type="number" min="0" step="0.01"
                      defaultValue={row.asking_price ?? ''} />
                    <Field name="offered_price" label="Oferta inicial" type="number" min="0" step="0.01"
                      defaultValue={row.offered_price ?? ''} />
                    <Field name="final_price" label="Precio final (si aplica)" type="number" min="0" step="0.01"
                      defaultValue={row.final_price ?? ''} />
                    <Field name="commission_percentage" label="Comisión %" type="number"
                      min="0" max="100" step="0.01" defaultValue={row.commission_percentage ?? ''} />
                    <div className="md:col-span-2 flex justify-end gap-2">
                      <button type="button" disabled={busy} onClick={() => setEditingId(null)}
                        className="rounded-lg border px-4 py-2 text-sm font-semibold">Cancelar</button>
                      <button type="submit" disabled={busy || loadingOptions || !hasRequiredOptions}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                        {busy ? 'Guardando…' : 'Guardar cambios'}
                      </button>
                    </div>
                  </form>
                </td>
              </tr>}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500"><Handshake className="mx-auto mb-2 h-6 w-6" />No hay negocios registrados.</td></tr>
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
