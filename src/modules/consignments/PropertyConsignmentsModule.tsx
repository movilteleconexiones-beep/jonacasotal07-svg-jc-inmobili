import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { consignmentErrorMessage, type PropertyConsignmentInput } from '../../core/property-consignment';
import { supabase } from '../../lib/supabase';

interface ConsignmentRow {
  id: string;
  reference: string;
  contact_name: string;
  contact_phone: string;
  payload: Omit<PropertyConsignmentInput, 'owner_name' | 'owner_phone' | 'contact_consent'> & { currency: string; country: string };
  status: 'NEW' | 'ACCEPTED' | 'REJECTED';
  created_at: string;
  reviewed_at: string | null;
  review_notes: string | null;
}

const PAGE_SIZE = 25;
const STATUS_LABELS = { NEW: 'Pendiente', ACCEPTED: 'Aceptada', REJECTED: 'Rechazada' };
const OPERATION_LABELS = { SALE: 'Venta', RENT: 'Renta', ADMINISTRATION: 'Administración' };
const TYPE_LABELS = { HOUSE: 'Casa', APARTMENT: 'Apartamento', COMMERCIAL: 'Comercial' };

export function PropertyConsignmentsModule() {
  const { activeMembership, can } = useAuth();
  const organizationId = activeMembership?.organization.id;
  const canView = can(PERMISSIONS.PROPERTIES_VIEW) && can(PERMISSIONS.CLIENTS_VIEW);
  const canReview = canView && can(PERMISSIONS.PROPERTIES_EDIT);
  const canAccept = canReview && can(PERMISSIONS.PROPERTIES_CREATE) && can(PERMISSIONS.CLIENTS_CREATE) && can(PERMISSIONS.LEADS_EDIT);
  const [rows, setRows] = useState<ConsignmentRow[]>([]);
  const [filter, setFilter] = useState('NEW');
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [selected, setSelected] = useState<ConsignmentRow | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const loadVersion = useRef(0);
  const reviewLock = useRef(false);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    if (!organizationId || !canView) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let query = supabase.from('property_consignments')
        .select('id, reference, contact_name, contact_phone, payload, status, created_at, reviewed_at, review_notes')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }).order('id')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (filter) query = query.eq('status', filter);
      const { data, error } = await query;
      if (version !== loadVersion.current) return;
      if (error) {
        setRows([]);
        setMessage('No se pudo cargar la bandeja. Verifica tus permisos e intenta actualizar.');
      } else {
        const results = (data ?? []) as unknown as ConsignmentRow[];
        setRows(results.slice(0, PAGE_SIZE));
        setHasNext(results.length > PAGE_SIZE);
      }
    } catch {
      if (version === loadVersion.current) setMessage('No se pudo conectar. Intenta actualizar la bandeja.');
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [organizationId, canView, filter, page]);

  useEffect(() => {
    setSelected(null);
    setRows([]);
    void load();
    return () => { ++loadVersion.current; };
  }, [load]);

  async function review(decision: 'ACCEPTED' | 'REJECTED') {
    if (reviewLock.current || !selected || !canReview || (decision === 'ACCEPTED' && !canAccept)) return;
    reviewLock.current = true;
    setSubmitting(true);
    setMessage('');
    try {
      const { data, error } = await supabase.rpc('review_property_consignment', {
        p_id: selected.id, p_decision: decision, p_notes: notes.trim(),
      });
      if (error || data?.status !== decision) {
        setMessage(consignmentErrorMessage(error));
        return;
      }
      setSelected(null);
      setNotes('');
      setMessage(decision === 'ACCEPTED'
        ? 'Consignación aceptada: borrador en Propiedades, contacto en Clientes y oportunidad en Leads / CRM.'
        : 'Consignación rechazada. Se conserva el registro de la revisión.');
      await load();
    } catch {
      setMessage('No se pudo confirmar la revisión. Actualiza la bandeja antes de reintentar.');
    } finally {
      reviewLock.current = false;
      setSubmitting(false);
    }
  }

  if (!canView) return <p role="alert">No tienes permiso para consultar consignaciones.</p>;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Consignaciones</h1>
          <p className="mt-1 text-sm text-slate-600">Solicitudes del portal. Al aceptarlas se crea un borrador privado y una oportunidad comercial.</p>
        </div>
        <button type="button" disabled={loading || submitting} onClick={() => { setMessage(''); void load(); }} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
      </div>
      <label className="block max-w-xs text-sm font-medium">Estado
        <select value={filter} disabled={submitting} onChange={e => { setFilter(e.target.value); setPage(0); setMessage(''); }} className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2">
          <option value="">Todos</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {message && <p role="status" className="rounded-xl border border-stone-200 bg-white p-3 text-sm">{message}</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          {loading ? <p role="status">Cargando consignaciones…</p> : rows.length === 0 ? <p className="rounded-xl bg-white p-5 text-sm text-slate-600">No hay consignaciones en esta página.</p> : rows.map(row => (
            <button key={row.id} type="button" disabled={submitting} onClick={() => { setSelected(row); setNotes(row.review_notes ?? ''); }} className={`w-full rounded-xl border bg-white p-4 text-left ${selected?.id === row.id ? 'border-slate-900' : 'border-stone-200'}`}>
              <div className="flex justify-between gap-2"><strong>{row.payload.title}</strong><span className="text-xs text-slate-600">{STATUS_LABELS[row.status]}</span></div>
              <p className="mt-1 text-sm text-slate-600">{row.payload.city}, {row.payload.state} · {OPERATION_LABELS[row.payload.operation_type]}</p>
              <p className="mt-1 text-xs text-slate-500">{new Date(row.created_at).toLocaleString('es-CO')}</p>
              <p className="mt-2 break-all font-mono text-xs text-slate-500">{row.reference}</p>
            </button>
          ))}
          <div className="flex items-center justify-between gap-3 text-sm">
            <button type="button" disabled={page === 0 || loading || submitting} onClick={() => setPage(p => p - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Anterior</button>
            <span>Página {page + 1}</span>
            <button type="button" disabled={!hasNext || loading || submitting} onClick={() => setPage(p => p + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Siguiente</button>
          </div>
        </div>
        {selected && <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-lg font-bold">{selected.payload.title}</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-slate-500">Contacto</dt><dd>{selected.contact_name}</dd></div>
            <div><dt className="text-slate-500">Teléfono</dt><dd>{selected.contact_phone}</dd></div>
            <div><dt className="text-slate-500">Tipo</dt><dd>{TYPE_LABELS[selected.payload.property_type]}</dd></div>
            <div><dt className="text-slate-500">Valor declarado</dt><dd>{new Intl.NumberFormat('es-CO', { style: 'currency', currency: selected.payload.currency }).format(selected.payload.price)}</dd></div>
            <div><dt className="text-slate-500">Terreno / construcción</dt><dd>{selected.payload.lot_area} / {selected.payload.built_area} m²</dd></div>
            <div><dt className="text-slate-500">Habitaciones / baños / parqueaderos</dt><dd>{selected.payload.bedrooms} / {selected.payload.bathrooms} / {selected.payload.parking_spaces}</dd></div>
            <div><dt className="text-slate-500">Año de construcción</dt><dd>{selected.payload.construction_year ?? 'No informado'}</dd></div>
            <div><dt className="text-slate-500">Administración</dt><dd>{selected.payload.administration_fee} {selected.payload.currency}</dd></div>
          </dl>
          <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{selected.payload.description || 'Sin descripción adicional.'}</p>
          <p className="text-sm text-slate-600">Ubicación: {[selected.payload.neighborhood, selected.payload.city, selected.payload.state].filter(Boolean).join(', ')}</p>
          {selected.status === 'NEW' && canReview ? <>
            <label className="block text-sm font-medium">Notas de revisión
              <textarea value={notes} maxLength={1000} disabled={submitting} onChange={e => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2" />
            </label>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={!canAccept || submitting} onClick={() => void review('ACCEPTED')} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{submitting ? 'Procesando…' : 'Aceptar y crear borrador'}</button>
              <button type="button" disabled={submitting} onClick={() => void review('REJECTED')} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold disabled:opacity-40">Rechazar</button>
            </div>
            {!canAccept && <p className="text-xs text-slate-500">Para aceptar se requieren permisos de creación de propiedades, clientes y edición de leads.</p>}
          </> : <p className="text-sm text-slate-500">{selected.review_notes || STATUS_LABELS[selected.status]}</p>}
        </div>}
      </div>
    </section>
  );
}
