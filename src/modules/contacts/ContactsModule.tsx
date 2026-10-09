import { useEffect, useState, type FormEvent } from 'react';
import { ContactRound, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';

interface ContactRow {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string;
  created_at: string;
}

export function ContactsModule() {
  const { user, activeMembership, can } = useAuth();
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState('');

  const organizationId = activeMembership?.organization.id;

  async function load() {
    if (!organizationId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, email, phone, whatsapp, source, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) setMessage(error.message);
    else setRows((data ?? []) as ContactRow[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  async function createContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !user || !can(PERMISSIONS.CLIENTS_CREATE)) {
      setMessage('No tienes permiso para crear contactos.');
      return;
    }

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const phone = String(form.get('phone') ?? '').trim();
    const whatsapp = String(form.get('whatsapp') ?? '').trim();
    if (!email && !phone && !whatsapp) {
      setMessage('Ingresa al menos un medio de contacto: correo, teléfono o WhatsApp.');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage('Ingresa un correo electrónico válido.');
      return;
    }
    for (const number of [phone, whatsapp]) {
      const length = number.replace(/\D/g, '').length;
      if (number && (length < 7 || length > 15)) {
        setMessage('Los teléfonos deben contener entre 7 y 15 dígitos.');
        return;
      }
    }
    const payload = {
      organization_id: organizationId,
      first_name: String(form.get('first_name') ?? '').trim(),
      last_name: String(form.get('last_name') ?? '').trim() || null,
      email: email || null,
      phone: phone || null,
      whatsapp: whatsapp || null,
      source: String(form.get('source') ?? 'MANUAL'),
      notes: String(form.get('notes') ?? '').trim() || null,
      assigned_agent_id: user.id,
      created_by: user.id,
    };

    const { error } = await supabase.from('contacts').insert(payload);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Cliente/contacto creado correctamente.');
    setShowCreate(false);
    event.currentTarget.reset();
    await load();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Clientes y contactos</h1>
          <p className="mt-1 text-sm text-slate-600">Compradores, arrendatarios, propietarios y prospectos.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold">
            <RefreshCw className="h-4 w-4" /> Actualizar
          </button>
          {can(PERMISSIONS.CLIENTS_CREATE) && (
            <button type="button" onClick={() => setShowCreate((v) => !v)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> Nuevo contacto
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createContact} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
          <Field name="first_name" label="Nombre" required />
          <Field name="last_name" label="Apellido" />
          <Field name="email" label="Correo" type="email" />
          <Field name="phone" label="Teléfono" />
          <Field name="whatsapp" label="WhatsApp" />
          <label>
            <span className="mb-1 block text-sm font-medium">Origen</span>
            <select name="source" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="MANUAL">Manual</option>
              <option value="WEBSITE">Sitio web</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="INSTAGRAM">Instagram</option>
              <option value="FACEBOOK">Facebook</option>
              <option value="PORTAL">Portal inmobiliario</option>
              <option value="REFERRAL">Referido</option>
              <option value="PHONE">Llamada</option>
              <option value="OTHER">Otro</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium">Notas</span>
            <textarea name="notes" rows={3} className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold">Cancelar</button>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Guardar contacto</button>
          </div>
        </form>
      )}

      {message && <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm">{message}</div>}

      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Correo</th>
              <th className="px-4 py-3">Teléfono</th>
              <th className="px-4 py-3">WhatsApp</th>
              <th className="px-4 py-3">Origen</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  <ContactRound className="mx-auto mb-2 h-6 w-6" />
                  Aún no hay clientes o contactos registrados.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-stone-100">
                <td className="px-4 py-3 font-semibold">{[row.first_name, row.last_name].filter(Boolean).join(' ')}</td>
                <td className="px-4 py-3">{row.email || '—'}</td>
                <td className="px-4 py-3">{row.phone || '—'}</td>
                <td className="px-4 py-3">{row.whatsapp || '—'}</td>
                <td className="px-4 py-3">{row.source}</td>
              </tr>
            ))}
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
