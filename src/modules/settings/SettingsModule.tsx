import { useEffect, useState, type FormEvent } from 'react';
import { Palette, Save } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { supabase } from '../../lib/supabase';
import { useTenantBranding } from '../../core/use-tenant-branding';

export function SettingsModule() {
  const { activeMembership, can } = useAuth();
  const { branding, refresh } = useTenantBranding();
  const organizationId = activeMembership?.organization.id;

  const [companyName, setCompanyName] = useState('');
  const [softwareName, setSoftwareName] = useState('');
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [currency, setCurrency] = useState('COP');
  const [country, setCountry] = useState('CO');
  const [timezone, setTimezone] = useState('America/Bogota');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCompanyName(branding.companyName);
    setSoftwareName(branding.softwareName);
    setWebsite(branding.website ?? '');
    setPhone(branding.phone ?? '');
    setWhatsapp(branding.whatsapp ?? '');
    setEmail(branding.email ?? '');
    setCurrency(branding.currency);
    setCountry(branding.country);
    setTimezone(branding.timezone);
  }, [branding]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !can('settings.edit')) return;

    setSaving(true);
    setMessage('');

    const [orgResult, brandingResult, settingsResult] = await Promise.all([
      supabase
        .from('organizations')
        .update({ name: companyName.trim(), updated_at: new Date().toISOString() })
        .eq('id', organizationId),
      supabase
        .from('organization_branding')
        .upsert({
          organization_id: organizationId,
          company_name: companyName.trim(),
          software_name: softwareName.trim(),
          website: website.trim() || null,
          phone: phone.trim() || null,
          whatsapp: whatsapp.trim() || null,
          email: email.trim() || null,
          updated_at: new Date().toISOString(),
        }),
      supabase
        .from('organization_settings')
        .upsert({
          organization_id: organizationId,
          default_currency: currency,
          country,
          timezone,
          language: 'es',
          updated_at: new Date().toISOString(),
        }),
    ]);

    const error = orgResult.error || brandingResult.error || settingsResult.error;
    if (error) {
      setMessage(error.message);
    } else {
      setMessage('Identidad y configuración guardadas correctamente.');
      await refresh();
    }
    setSaving(false);
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Identidad y configuración</h1>
        <p className="mt-1 text-sm text-slate-600">
          Personaliza el software para tu inmobiliaria sin modificar el código.
        </p>
      </div>

      <form onSubmit={save} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
        <div className="md:col-span-2 flex items-center gap-3 border-b border-stone-100 pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Palette className="h-5 w-5" />
          </div>
          <div>
            <div className="font-bold">Marca del cliente</div>
            <div className="text-sm text-slate-500">Aplica tanto para SaaS mensual como para licencia dedicada.</div>
          </div>
        </div>

        <Field label="Nombre de la inmobiliaria" value={companyName} onChange={setCompanyName} required />
        <Field label="Nombre del software" value={softwareName} onChange={setSoftwareName} required />
        <Field label="Sitio web" value={website} onChange={setWebsite} />
        <Field label="Correo comercial" value={email} onChange={setEmail} type="email" />
        <Field label="Teléfono" value={phone} onChange={setPhone} />
        <Field label="WhatsApp" value={whatsapp} onChange={setWhatsapp} />

        <label>
          <span className="mb-1 block text-sm font-medium">Moneda principal</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
            <option value="COP">COP - Peso colombiano</option>
            <option value="USD">USD - Dólar estadounidense</option>
          </select>
        </label>

        <label>
          <span className="mb-1 block text-sm font-medium">País</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)} className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
            <option value="CO">Colombia</option>
          </select>
        </label>

        <label className="md:col-span-2">
          <span className="mb-1 block text-sm font-medium">Zona horaria</span>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
            <option value="America/Bogota">America/Bogota</option>
          </select>
        </label>

        {message && (
          <div className="md:col-span-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
            {message}
          </div>
        )}

        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={saving || !can('settings.edit')}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-stone-300 px-3 py-2.5"
      />
    </label>
  );
}
