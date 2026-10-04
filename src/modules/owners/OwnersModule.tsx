import { useEffect, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, UserRoundCog } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';

interface OwnerRow {
  id: string;
  first_name: string;
  last_name: string | null;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  notes: string | null;
  created_at: string;
}

interface PropertyOption {
  id: string;
  code: string;
  title: string;
}

export function OwnersModule() {
  const { user, activeMembership, can } = useAuth();
  const organizationId = activeMembership?.organization.id;
  const [owners, setOwners] = useState<OwnerRow[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    if (!organizationId) return;
    const [ownersResult, propertiesResult] = await Promise.all([
      supabase
        .from('property_owners')
        .select('id,first_name,last_name,document_type,document_number,email,phone,whatsapp,notes,created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }),
      supabase
        .from('properties')
        .select('id,code,title')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false }),
    ]);

    if (ownersResult.error) setMessage(ownersResult.error.message);
    else setOwners((ownersResult.data ?? []) as OwnerRow[]);

    if (!propertiesResult.error) {
      setProperties((propertiesResult.data ?? []) as PropertyOption[]);
    }
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  async function createOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !user) return;

    const form = new FormData(event.currentTarget);
    const propertyId = String(form.get('property_id') ?? '').trim();
    const ownershipPctRaw = String(form.get('ownership_percentage') ?? '').trim();
    const ownershipPct = ownershipPctRaw ? Number(ownershipPctRaw) : 100;

    const { data, error } = await supabase
      .from('property_owners')
      .insert({
        organization_id: organizationId,
        first_name: String(form.get('first_name') ?? '').trim(),
        last_name: String(form.get('last_name') ?? '').trim() || null,
        document_type: String(form.get('document_type') ?? '').trim() || null,
        document_number: String(form.get('document_number') ?? '').trim() || null,
        email: String(form.get('email') ?? '').trim() || null,
        phone: String(form.get('phone') ?? '').trim() || null,
        whatsapp: String(form.get('whatsapp') ?? '').trim() || null,
        notes: String(form.get('notes') ?? '').trim() || null,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (error) {
      setMessage(error.message);
      return;
    }

    if (propertyId) {
      const { error: ownershipError } = await supabase
        .from('property_ownerships')
        .insert({
          property_id: propertyId,
          owner_id: data.id,
          ownership_percentage: ownershipPct,
          is_primary: true,
        });

      if (ownershipError) {
        setMessage('Propietario creado, pero no se pudo vincular al inmueble: ' + ownershipError.message);
        await load();
        return;
      }
    }

    setMessage('Propietario registrado correctamente.');
    setShowCreate(false);
    event.currentTarget.reset();
    await load();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Propietarios</h1>
          <p className="mt-1 text-sm text-slate-600">
            Registra propietarios y vincúlalos con sus inmuebles.
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

          {can(PERMISSIONS.OWNERS_CREATE) && (
            <button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              Nuevo propietario
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createOwner} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
          <Field name="first_name" label="Nombre" required />
          <Field name="last_name" label="Apellido" />
          <Field name="document_type" label="Tipo de documento" placeholder="CC, CE, NIT..." />
          <Field name="document_number" label="Número de documento" />
          <Field name="email" label="Correo" type="email" />
          <Field name="phone" label="Teléfono" />
          <Field name="whatsapp" label="WhatsApp" />

          <label>
            <span className="mb-1 block text-sm font-medium">Inmueble asociado</span>
            <select name="property_id" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="">Sin asociar por ahora</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.code} · {property.title}
                </option>
              ))}
            </select>
          </label>

          <Field
            name="ownership_percentage"
            label="Participación %"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            defaultValue="100"
          />

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
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              Guardar propietario
            </button>
          </div>
        </form>
      )}

      {message && <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm">{message}</div>}

      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="px-4 py-3">Propietario</th>
              <th className="px-4 py-3">Documento</th>
              <th className="px-4 py-3">Contacto</th>
              <th className="px-4 py-3">Notas</th>
            </tr>
          </thead>
          <tbody>
            {owners.map((owner) => (
              <tr key={owner.id} className="border-t border-stone-100">
                <td className="px-4 py-3 font-semibold">
                  {[owner.first_name, owner.last_name].filter(Boolean).join(' ')}
                </td>
                <td className="px-4 py-3">
                  {[owner.document_type, owner.document_number].filter(Boolean).join(' ') || '—'}
                </td>
                <td className="px-4 py-3">
                  <div>{owner.phone || owner.whatsapp || '—'}</div>
                  <div className="text-xs text-slate-500">{owner.email || ''}</div>
                </td>
                <td className="px-4 py-3">{owner.notes || '—'}</td>
              </tr>
            ))}

            {owners.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                  <UserRoundCog className="mx-auto mb-2 h-6 w-6" />
                  Aún no hay propietarios registrados.
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
