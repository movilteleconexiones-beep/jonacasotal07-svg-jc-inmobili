import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, UsersRound } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';

const STATUSES = [
  ['NEW', 'Nuevo'],
  ['CONTACTED', 'Contactado'],
  ['QUALIFIED', 'Calificado'],
  ['VISIT_SCHEDULED', 'Visita programada'],
  ['NEGOTIATION', 'Negociación'],
  ['WON', 'Ganado'],
  ['LOST', 'Perdido'],
] as const;

interface LeadRow {
  id: string;
  contact_id: string;
  property_id: string | null;
  status: string;
  priority: string;
  budget_min: number | null;
  budget_max: number | null;
  desired_operation: string | null;
  notes: string | null;
  created_at: string;
  contacts: { first_name: string; last_name: string | null } | null;
  properties: { code: string; title: string } | null;
}

interface ContactOption { id: string; first_name: string; last_name: string | null }
interface PropertyOption { id: string; code: string; title: string }

export function LeadsModule() {
  const { user, activeMembership, can } = useAuth();
  const organizationId = activeMembership?.organization.id;
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    if (!organizationId) return;
    setLoading(true);

    const [leadResult, contactResult, propertyResult] = await Promise.all([
      supabase
        .from('leads')
        .select('id, contact_id, property_id, status, priority, budget_min, budget_max, desired_operation, notes, created_at, contacts(first_name,last_name), properties(code,title)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }),
      supabase
        .from('contacts')
        .select('id, first_name, last_name')
        .eq('organization_id', organizationId)
        .order('first_name'),
      supabase
        .from('properties')
        .select('id, code, title')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }),
    ]);

    if (leadResult.error) setMessage(leadResult.error.message);
    else setRows((leadResult.data ?? []) as unknown as LeadRow[]);

    if (!contactResult.error) setContacts((contactResult.data ?? []) as ContactOption[]);
    if (!propertyResult.error) setProperties((propertyResult.data ?? []) as PropertyOption[]);

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  const grouped = useMemo(() => {
    const groups = new Map<string, LeadRow[]>();
    for (const [status] of STATUSES) groups.set(status, []);
    for (const row of rows) groups.get(row.status)?.push(row);
    return groups;
  }, [rows]);

  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !user || !can(PERMISSIONS.LEADS_EDIT)) {
      setMessage('No tienes permiso para crear oportunidades comerciales.');
      return;
    }

    const form = new FormData(event.currentTarget);
    const budgetMin = String(form.get('budget_min') ?? '').trim();
    const budgetMax = String(form.get('budget_max') ?? '').trim();
    const propertyId = String(form.get('property_id') ?? '').trim();

    const { error } = await supabase.from('leads').insert({
      organization_id: organizationId,
      contact_id: String(form.get('contact_id') ?? ''),
      property_id: propertyId || null,
      assigned_agent_id: user.id,
      status: 'NEW',
      priority: String(form.get('priority') ?? 'MEDIUM'),
      budget_min: budgetMin ? Number(budgetMin) : null,
      budget_max: budgetMax ? Number(budgetMax) : null,
      desired_operation: String(form.get('desired_operation') ?? '').trim() || null,
      notes: String(form.get('notes') ?? '').trim() || null,
      created_by: user.id,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Lead creado correctamente.');
    setShowCreate(false);
    event.currentTarget.reset();
    await load();
  }

  async function updateStatus(id: string, status: string) {
    if (!organizationId || !can(PERMISSIONS.LEADS_EDIT)) {
      setMessage('No tienes permiso para actualizar oportunidades comerciales.');
      return;
    }
    const { error } = await supabase.from('leads').update({ status }).eq('id', id).eq('organization_id', organizationId);
    if (error) setMessage(error.message);
    else await load();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leads / CRM</h1>
          <p className="mt-1 text-sm text-slate-600">Seguimiento comercial desde el primer contacto hasta el cierre.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold">
            <RefreshCw className="h-4 w-4" /> Actualizar
          </button>
          {can(PERMISSIONS.LEADS_EDIT) && (
            <button type="button" onClick={() => setShowCreate((v) => !v)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> Nuevo lead
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createLead} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
          <label>
            <span className="mb-1 block text-sm font-medium">Cliente / contacto *</span>
            <select name="contact_id" required className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="">Selecciona…</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {[contact.first_name, contact.last_name].filter(Boolean).join(' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Propiedad de interés</span>
            <select name="property_id" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="">Sin propiedad específica</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>{property.code} · {property.title}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Prioridad</span>
            <select name="priority" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="LOW">Baja</option>
              <option value="MEDIUM">Media</option>
              <option value="HIGH">Alta</option>
              <option value="URGENT">Urgente</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">Operación deseada</span>
            <select name="desired_operation" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="">Sin definir</option>
              <option value="SALE">Compra</option>
              <option value="RENT">Arriendo</option>
              <option value="INVESTMENT">Inversión</option>
            </select>
          </label>
          <Field name="budget_min" label="Presupuesto mínimo" type="number" min="0" />
          <Field name="budget_max" label="Presupuesto máximo" type="number" min="0" />
          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium">Notas</span>
            <textarea name="notes" rows={3} className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold">Cancelar</button>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Guardar lead</button>
          </div>
        </form>
      )}

      {message && <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm">{message}</div>}

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1260px] grid-cols-7 gap-3">
          {STATUSES.map(([status, label]) => {
            const items = grouped.get(status) ?? [];
            return (
              <div key={status} className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-sm font-bold">{label}</div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((lead) => (
                    <article key={lead.id} className="rounded-xl border border-stone-200 bg-white p-3">
                      <div className="font-semibold">
                        {[lead.contacts?.first_name, lead.contacts?.last_name].filter(Boolean).join(' ') || 'Contacto'}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {lead.properties ? lead.properties.code + ' · ' + lead.properties.title : 'Sin propiedad específica'}
                      </div>
                      <div className="mt-2 text-xs font-medium">Prioridad: {lead.priority}</div>
                      {can(PERMISSIONS.LEADS_EDIT) && (
                        <select
                          value={lead.status}
                          onChange={(event) => void updateStatus(lead.id, event.target.value)}
                          className="mt-3 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
                        >
                          {STATUSES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                        </select>
                      )}
                    </article>
                  ))}
                  {!loading && items.length === 0 && (
                    <div className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-xs text-slate-400">
                      Sin leads
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!loading && rows.length === 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-slate-500">
          <UsersRound className="mx-auto mb-2 h-6 w-6" />
          Crea tu primer lead o recibe uno desde el portal público.
        </div>
      )}
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
