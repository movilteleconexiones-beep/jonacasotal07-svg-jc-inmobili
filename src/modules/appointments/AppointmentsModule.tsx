import { useEffect, useState, type FormEvent } from 'react';
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

export function AppointmentsModule() {
  const { user, activeMembership, can } = useAuth();
  const { branding } = useTenantBranding();
  const organizationId = activeMembership?.organization.id;
  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    if (!organizationId) return;
    const [appointmentResult, contactResult, propertyResult] = await Promise.all([
      supabase
        .from('appointments')
        .select('id, appointment_type, status, starts_at, ends_at, location, notes, contacts(first_name,last_name), properties(code,title)')
        .eq('organization_id', organizationId)
        .order('starts_at', { ascending: true }),
      supabase.from('contacts').select('id, first_name, last_name').eq('organization_id', organizationId).order('first_name'),
      supabase.from('properties').select('id, code, title').eq('organization_id', organizationId).order('created_at', { ascending: false }),
    ]);

    if (appointmentResult.error) setMessage(appointmentResult.error.message);
    else setRows((appointmentResult.data ?? []) as unknown as AppointmentRow[]);
    if (!contactResult.error) setContacts((contactResult.data ?? []) as ContactOption[]);
    if (!propertyResult.error) setProperties((propertyResult.data ?? []) as PropertyOption[]);
  }

  useEffect(() => { void load(); }, [organizationId]);

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !user) return;
    const form = new FormData(event.currentTarget);
    const propertyId = String(form.get('property_id') ?? '').trim();
    const endsAt = String(form.get('ends_at') ?? '').trim();

    const { error } = await supabase.from('appointments').insert({
      organization_id: organizationId,
      contact_id: String(form.get('contact_id') ?? '') || null,
      property_id: propertyId || null,
      assigned_user_id: user.id,
      appointment_type: String(form.get('appointment_type') ?? 'VISIT'),
      status: 'SCHEDULED',
      starts_at: new Date(String(form.get('starts_at'))).toISOString(),
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      location: String(form.get('location') ?? '').trim() || null,
      notes: String(form.get('notes') ?? '').trim() || null,
      created_by: user.id,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Cita creada correctamente.');
    setShowCreate(false);
    event.currentTarget.reset();
    await load();
  }

  async function updateStatus(id: string, status: string) {
    const { error } = await supabase.from('appointments').update({ status }).eq('id', id);
    if (error) setMessage(error.message);
    else await load();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agenda y visitas</h1>
          <p className="mt-1 text-sm text-slate-600">Programa visitas, reuniones y seguimientos comerciales.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold">
            <RefreshCw className="h-4 w-4" /> Actualizar
          </button>
          {can(PERMISSIONS.APPOINTMENTS_CREATE) && (
            <button type="button" onClick={() => setShowCreate((v) => !v)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
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
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{[contact.first_name, contact.last_name].filter(Boolean).join(' ')}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Propiedad</span>
            <select name="property_id" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="">Sin propiedad</option>
              {properties.map((property) => <option key={property.id} value={property.id}>{property.code} · {property.title}</option>)}
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
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold">Cancelar</button>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Guardar cita</button>
          </div>
        </form>
      )}

      {message && <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm">{message}</div>}

      <div className="space-y-3">
        {rows.map((row) => (
          <article key={row.id} className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 md:grid-cols-[180px_1fr_180px] md:items-center">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{row.appointment_type}</div>
              <div className="mt-1 font-bold">{new Intl.DateTimeFormat(branding.locale || 'es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: branding.timezone || 'America/Bogota' }).format(new Date(row.starts_at))}</div>
            </div>
            <div>
              <div className="font-semibold">{[row.contacts?.first_name, row.contacts?.last_name].filter(Boolean).join(' ') || 'Sin cliente'}</div>
              <div className="mt-1 text-sm text-slate-500">{row.properties ? row.properties.code + ' · ' + row.properties.title : row.location || 'Sin propiedad'}</div>
            </div>
            {can(PERMISSIONS.APPOINTMENTS_EDIT) ? (
              <select value={row.status} onChange={(event) => void updateStatus(row.id, event.target.value)} className="rounded-lg border border-stone-300 px-2 py-2 text-sm">
                <option value="SCHEDULED">Programada</option>
                <option value="CONFIRMED">Confirmada</option>
                <option value="COMPLETED">Completada</option>
                <option value="CANCELLED">Cancelada</option>
                <option value="NO_SHOW">No asistió</option>
              </select>
            ) : <div className="text-sm font-medium">{row.status}</div>}
          </article>
        ))}
        {rows.length === 0 && (
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
