import { useEffect, useState, type FormEvent } from 'react';
import { Building2, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';
import { useTenantBranding } from '../../core/use-tenant-branding';

interface PropertyRow {
  id: string;
  code: string;
  title: string;
  operation_type: string;
  property_type: string;
  status: string;
  price: number | null;
  currency: string;
  city: string | null;
  neighborhood: string | null;
  created_at: string;
}

export function PropertiesModule() {
  const { user, activeMembership, can } = useAuth();
  const { branding } = useTenantBranding();
  const [rows, setRows] = useState<PropertyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState('');

  const organizationId = activeMembership?.organization.id;

  async function load() {
    if (!organizationId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('properties')
      .select('id, code, title, operation_type, property_type, status, price, currency, city, neighborhood, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) setMessage(error.message);
    else setRows((data ?? []) as PropertyRow[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  async function createProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !user) return;

    const form = new FormData(event.currentTarget);
    const priceValue = String(form.get('price') ?? '').trim();

    const payload = {
      organization_id: organizationId,
      code: String(form.get('code') ?? '').trim(),
      title: String(form.get('title') ?? '').trim(),
      description: String(form.get('description') ?? '').trim() || null,
      operation_type: String(form.get('operation_type') ?? 'SALE'),
      property_type: String(form.get('property_type') ?? '').trim(),
      status: 'AVAILABLE',
      price: priceValue ? Number(priceValue) : null,
      currency: String(form.get('currency') ?? 'COP'),
      city: String(form.get('city') ?? '').trim() || null,
      neighborhood: String(form.get('neighborhood') ?? '').trim() || null,
      address: String(form.get('address') ?? '').trim() || null,
      created_by: user.id,
      assigned_agent_id: user.id,
    };

    const { error } = await supabase.from('properties').insert(payload);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Propiedad creada correctamente.');
    setShowCreate(false);
    event.currentTarget.reset();
    await load();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Propiedades</h1>
          <p className="mt-1 text-sm text-slate-600">Inventario privado de la inmobiliaria.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold">
            <RefreshCw className="h-4 w-4" /> Actualizar
          </button>
          {can(PERMISSIONS.PROPERTIES_CREATE) && (
            <button type="button" onClick={() => setShowCreate((v) => !v)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" /> Nueva propiedad
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={createProperty} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
          <Field name="code" label="Código" required />
          <Field name="title" label="Título" required />
          <SelectField name="operation_type" label="Operación" options={[
            ['SALE','Venta'], ['RENT','Arriendo'], ['SALE_OR_RENT','Venta o arriendo'], ['ADMINISTRATION','Administración'],
          ]} />
          <Field name="property_type" label="Tipo de inmueble" placeholder="Apartamento, casa, local..." required />
          <Field name="price" label="Precio" type="number" min="0" step="0.01" />
          <SelectField name="currency" label="Moneda" options={[['COP','COP'],['MXN','MXN'],['USD','USD']]} />
          <Field name="city" label="Ciudad" />
          <Field name="neighborhood" label="Barrio / zona" />
          <div className="md:col-span-2"><Field name="address" label="Dirección" /></div>
          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium">Descripción</span>
            <textarea name="description" rows={4} className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-semibold">Cancelar</button>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Guardar propiedad</button>
          </div>
        </form>
      )}

      {message && <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm">{message}</div>}

      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left">
            <tr>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Propiedad</th>
              <th className="px-4 py-3">Operación</th>
              <th className="px-4 py-3">Ubicación</th>
              <th className="px-4 py-3">Precio</th>
              <th className="px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  <Building2 className="mx-auto mb-2 h-6 w-6" />
                  Aún no hay propiedades registradas.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-stone-100">
                <td className="px-4 py-3 font-mono text-xs">{row.code}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold">{row.title}</div>
                  <div className="text-xs text-slate-500">{row.property_type}</div>
                </td>
                <td className="px-4 py-3">{operationLabel(row.operation_type)}</td>
                <td className="px-4 py-3">{[row.neighborhood, row.city].filter(Boolean).join(', ') || '—'}</td>
                <td className="px-4 py-3 font-semibold">
                  {row.price == null ? '—' : new Intl.NumberFormat(branding.locale || 'es-CO', { style: 'currency', currency: row.currency || branding.currency || 'COP', maximumFractionDigits: 0 }).format(row.price)}
                </td>
                <td className="px-4 py-3">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function operationLabel(value: string) {
  return ({ SALE: 'Venta', RENT: 'Arriendo', SALE_OR_RENT: 'Venta / arriendo', ADMINISTRATION: 'Administración' } as Record<string,string>)[value] ?? value;
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

function SelectField({ name, label, options }: { name: string; label: string; options: [string,string][] }) {
  return (
    <label>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <select name={name} className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </label>
  );
}
