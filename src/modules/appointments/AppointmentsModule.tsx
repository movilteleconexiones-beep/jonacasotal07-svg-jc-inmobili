import { useEffect, useRef, useState, type FormEvent } from 'react';
import { etiquetaES } from '../../core/etiquetas-es';
import { CalendarDays, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';
import { useTenantBranding } from '../../core/use-tenant-branding';

interface AppointmentRow {
  id: string;
  appointment_type: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  contacts: { first_name: string; last_name: string | null } | null;
  properties: { code: string; title: string } | null;
}

interface ContactOption { id: string; first_name: string; last_name: string | null }
interface PropertyOption { id: string; code: string; title: string }
const APPOINTMENT_STATUSES = new Set(['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);

export function AppointmentsModule() {
  const { user, activeMembership, can } = useAuth();
  const { branding } = useTenantBranding();
  const organizationId = activeMembership?.organization.id;
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState('');
  // Data from organization A must never render in organization B, not even
  // during the first render before React runs the effect for the new tenant.
  const [loadedOrganization, setLoadedOrganization] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lookupsReady, setLookupsReady] = useState(false);
  const loadVersion = useRef(0);
  const currentOrganization = useRef(organizationId);
  currentOrganization.current = organizationId;
  const saveInFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const updateInFlight = useRef(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const visibleRows = loadedOrganization === organizationId ? rows : [];
  const visibleContacts = loadedOrganization === organizationId ? contacts : [];
  const visibleProperties = loadedOrganization === organizationId ? properties : [];
  const ready = !loading && loadedOrganization === organizationId && lookupsReady;

  async function load(): Promise<boolean> {
    const version = ++loadVersion.current;
    setRows([]);
    setContacts([]);
    setProperties([]);
    setLoadedOrganization(null);
    setLookupsReady(false);
    if (!organizationId) { setLoading(false); return false; }
    setLoading(true);
    try {
      const [appointmentResult, contactResult, propertyResult] = await Promise.all([
        supabase
          .from('appointments')
          .select('id, appointment_type, status, starts_at, ends_at, location, notes, contacts(first_name,last_name), properties(code,title)')
          .eq('organization_id', organizationId)
          .order('starts_at', { ascending: true }),
        supabase.from('contacts').select('id, first_name, last_name')
          .eq('organization_id', organizationId).order('first_name'),
        supabase.from('properties').select('id, code, title')
          .eq('organization_id', organizationId).order('created_at', { ascending: false }),
      ]);
      if (version !== loadVersion.current || currentOrganization.current !== organizationId) return false;
      const rowsOk = !appointmentResult.error;
      const optionsOk = !contactResult.error && !propertyResult.error;
      if (!rowsOk) setMessage('No se pudieron consultar las citas. Comprueba tus permisos y actualiza.');
      if (!optionsOk) setMessage('No se pudieron verificar los clientes o inmuebles de esta inmobiliaria. Actualiza antes de registrar.');
      setRows(rowsOk ? ((appointmentResult.data ?? []) as unknown as AppointmentRow[]) : []);
      setContacts(contactResult.error ? [] : ((contactResult.data ?? []) as ContactOption[]));
      setProperties(propertyResult.error ? [] : ((propertyResult.data ?? []) as PropertyOption[]));
      setLookupsReady(optionsOk);
      setLoadedOrganization(organizationId);
      return rowsOk && optionsOk;
    } catch {
      if (version !== loadVersion.current || currentOrganization.current !== organizationId) return false;
      setMessage('No fue posible conectar con la agenda. Actualiza antes de continuar.');
      return false;
    } finally {
      if (version === loadVersion.current && currentOrganization.current === organizationId)
        setLoading(false);
    }
  }

  useEffect(() => {
    setMessage('');
    setShowCreate(false);
    void load();
    return () => { ++loadVersion.current; };
  }, [organizationId]);

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInFlight.current || saving) return;
    if (!organizationId || !user || !can(PERMISSIONS.APPOINTMENTS_CREATE)) {
      setMessage('No tienes permiso para crear citas.');
      return;
    }
    if (!ready) {
      setMessage('Primero verifica la agenda, los clientes y los inmuebles de esta inmobiliaria.');
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const contactId = String(form.get('contact_id') ?? '').trim();
    const propertyId = String(form.get('property_id') ?? '').trim();
    // A previous tenant's option or a manually forged form must fail before write.
    if (contactId && !visibleContacts.some(contact => contact.id === contactId)) {
      setMessage('Selecciona un cliente válido de esta inmobiliaria.');
      return;
    }
    if (propertyId && !visibleProperties.some(property => property.id === propertyId)) {
      setMessage('Selecciona un inmueble válido de esta inmobiliaria.');
      return;
    }
    const endsAt = String(form.get('ends_at') ?? '').trim();
    const startsAtDate = new Date(String(form.get('starts_at') ?? ''));
    const endsAtDate = endsAt ? new Date(endsAt) : null;
    if (!Number.isFinite(startsAtDate.getTime()) || startsAtDate.getTime() < Date.now() ||
       (endsAtDate && (!Number.isFinite(endsAtDate.getTime()) || endsAtDate <= startsAtDate))) {
      setMessage('Verifica las fechas: el inicio no puede estar en el pasado y el fin debe ser posterior al inicio.');
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    try {
      const { data, error } = await supabase.from('appointments').insert({
        organization_id: organizationId,
        contact_id: contactId || null,
        property_id: propertyId || null,
        assigned_user_id: user.id,
        appointment_type: String(form.get('appointment_type') ?? 'VISIT'),
        status: 'SCHEDULED',
        starts_at: startsAtDate.toISOString(),
        ends_at: endsAtDate ? endsAtDate.toISOString() : null,
        location: String(form.get('location') ?? '').trim() || null,
        notes: String(form.get('notes') ?? '').trim() || null,
        created_by: user.id,
      }).select('id').single();
      if (currentOrganization.current !== organizationId) return;
      if (error || !data?.id) {
        setMessage('No se pudo confirmar la cita. Actualiza la agenda y verifica si ya existe antes de reintentar.');
        return;
      }
      setShowCreate(false);
      formElement.reset();
      const refreshed = await load();
      if (currentOrganization.current === organizationId) setMessage(refreshed
        ? 'Cita creada correctamente.'
        : 'Cita registrada, pero no se pudo verificar la agenda actualizada. Pulsa Actualizar.');
    } catch {
      if (currentOrganization.current === organizationId)
        setMessage('No se confirmó el registro. Actualiza la agenda y revisa si la cita existe antes de reintentar.');
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    if (updateInFlight.current) return;
    if (!organizationId || !can(PERMISSIONS.APPOINTMENTS_EDIT)) {
      setMessage('No tienes permiso para modificar citas.');
      return;
    }
    if (!APPOINTMENT_STATUSES.has(status) || !visibleRows.some(row => row.id === id)) {
      setMessage('Selecciona una cita y un estado válidos de esta inmobiliaria.');
      return;
    }
    updateInFlight.current = true;
    setUpdatingId(id);
    try {
      const { data, error } = await supabase.from('appointments')
        .update({ status }).eq('id', id).eq('organization_id', organizationId)
        .select('id,status').maybeSingle();
      if (currentOrganization.current !== organizationId) return;
      const refreshed = await load();
      if (currentOrganization.current !== organizationId) return;
      if (error || !data || data.status !== status) {
        setMessage('No se pudo confirmar el cambio de estado de la cita. Comprueba tus permisos y actualiza.');
      } else {
        setMessage(refreshed ? 'Estado de la cita actualizado correctamente.' :
          'Estado guardado, pero no fue posible verificar la agenda. Pulsa Actualizar.');
      }
    } catch {
      if (currentOrganization.current === organizationId) {
        await load();
        setMessage('No se confirmó el cambio de estado. Revisa la cita antes de reintentar.');
      }
    } finally {
      updateInFlight.current = false;
      setUpdatingId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agenda y visitas</h1>
          <p className="mt-1 text-sm text-slate-600">Programa visitas, reuniones y seguimientos comerciales.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} disabled={saving || updatingId !== null} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold">
            <RefreshCw className="h-4 w-4" /> Actualizar
          </button>
          {can(PERMISSIONS.APPOINTMENTS_CREATE) && (
            <button type="button" onClick={() => setShowCreate((v) => !v)} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> Nueva cita
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createAppointment} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
          <label>
            <span className="mb-1 block text-sm font-medium">Cliente</span>
            <select name="contact_id" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="">Sin cliente</option>
              {visibleContacts.map((contact) => <option key={contact.id} value={contact.id}>{[contact.first_name, contact.last_name].filter(Boolean).join(' ')}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Propiedad</span>
            <select name="property_id" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="">Sin propiedad</option>
              {visibleProperties.map((property) => <option key={property.id} value={property.id}>{property.code} · {property.title}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Tipo</span>
            <select name="appointment_type" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="VISIT">Visita</option>
              <option value="MEETING">Reunión</option>
              <option value="CALL">Llamada</option>
              <option value="FOLLOW_UP">Seguimiento</option>
            </select>
          </label>
          <Field name="location" label="Lugar / enlace" />
          <Field name="starts_at" label="Inicio" type="datetime-local" required />
          <Field name="ends_at" label="Fin" type="datetime-local" />
          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium">Notas</span>
            <textarea name="notes" rows={3} className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" disabled={saving} onClick={() => setShowCreate(false)} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold">Cancelar</button>
            <button type="submit" disabled={!ready || saving} aria-busy={saving} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Guardando cita…' : 'Guardar cita'}</button>
          </div>
        </form>
      )}

      {message && <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm">{message}</div>}

      <div className="space-y-3">
        {visibleRows.map((row) => (
          <article key={row.id} className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 md:grid-cols-[180px_1fr_180px] md:items-center">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{etiquetaES(row.appointment_type)}</div>
              <div className="mt-1 font-bold">{new Intl.DateTimeFormat(branding.locale || 'es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: branding.timezone || 'America/Bogota' }).format(new Date(row.starts_at))}</div>
            </div>
            <div>
              <div className="font-semibold">{[row.contacts?.first_name, row.contacts?.last_name].filter(Boolean).join(' ') || 'Sin cliente'}</div>
              <div className="mt-1 text-sm text-slate-500">{row.properties ? row.properties.code + ' · ' + row.properties.title : row.location || 'Sin propiedad'}</div>
            </div>
            {can(PERMISSIONS.APPOINTMENTS_EDIT) ? (
              <select value={row.status} disabled={updatingId !== null} onChange={(event) => void updateStatus(row.id, event.target.value)} className="rounded-lg border border-stone-300 px-2 py-2 text-sm">
                <option value="SCHEDULED">Programada</option>
                <option value="CONFIRMED">Confirmada</option>
                <option value="COMPLETED">Completada</option>
                <option value="CANCELLED">Cancelada</option>
                <option value="NO_SHOW">No asistió</option>
              </select>
            ) : <div className="text-sm font-medium">{etiquetaES(row.status)}</div>}
          </article>
        ))}
        {!loading && loadedOrganization === organizationId && visibleRows.length === 0 && (
          <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-slate-500">
            <CalendarDays className="mx-auto mb-2 h-6 w-6" /> No hay citas programadas.
          </div>
        )}
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
