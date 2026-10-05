import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FileCheck2, Palette, Save } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { getCountryOption, LATAM_COUNTRIES } from '../../core/countries';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { supabase } from '../../lib/supabase';

interface ComplianceInfo {
  status: string;
  title?: string;
  version?: string;
  authority?: string;
  summary?: string;
}

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
  const [compliance, setCompliance] = useState<ComplianceInfo>({ status: 'PENDING' });
  const [licenseType, setLicenseType] = useState('SAAS');
  const [whiteLabelAllowed, setWhiteLabelAllowed] = useState(false);

  const selectedCountry = useMemo(() => getCountryOption(country), [country]);

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

  useEffect(() => {
    if (!organizationId) return;

    void supabase
      .from('organization_licenses')
      .select('license_type,white_label_allowed')
      .eq('organization_id', organizationId)
      .maybeSingle()
      .then(({ data }) => {
        setLicenseType((data as any)?.license_type ?? 'SAAS');
        setWhiteLabelAllowed(Boolean((data as any)?.white_label_allowed));
      });

    supabase
      .from('organization_compliance')
      .select('status, compliance_packs(title,version,authority,summary)')
      .eq('organization_id', organizationId)
      .maybeSingle()
      .then(({ data }) => {
        const pack = (data as any)?.compliance_packs;
        setCompliance({
          status: (data as any)?.status ?? 'PENDING',
          title: pack?.title ?? undefined,
          version: pack?.version ?? undefined,
          authority: pack?.authority ?? undefined,
          summary: pack?.summary ?? undefined,
        });
      });
  }, [organizationId, country]);

  function handleCountryChange(nextCountry: string) {
    const profile = getCountryOption(nextCountry);
    setCountry(profile.code);
    setCurrency(profile.currency);
    setTimezone(profile.timezone);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !can('settings.edit')) return;

    setSaving(true);
    setMessage('');

    const countryResult = await supabase.rpc('set_organization_country', {
      target_org: organizationId,
      target_country_code: country,
    });

    if (countryResult.error) {
      setMessage(countryResult.error.message);
      setSaving(false);
      return;
    }

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
          locale: selectedCountry.locale,
          language: selectedCountry.language,
          updated_at: new Date().toISOString(),
        }),
    ]);

    const error = orgResult.error || brandingResult.error || settingsResult.error;
    if (error) {
      setMessage(error.message);
    } else {
      setMessage('Identidad, país y configuración regional guardados correctamente.');
      await refresh();
      window.dispatchEvent(new Event('tenant-branding-updated'));

      const { data } = await supabase
        .from('organization_compliance')
        .select('status, compliance_packs(title,version,authority,summary)')
        .eq('organization_id', organizationId)
        .maybeSingle();

      const pack = (data as any)?.compliance_packs;
      setCompliance({
        status: (data as any)?.status ?? 'PENDING',
        title: pack?.title ?? undefined,
        version: pack?.version ?? undefined,
        authority: pack?.authority ?? undefined,
        summary: pack?.summary ?? undefined,
      });
    }

    setSaving(false);
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Identidad y configuración</h1>
        <p className="mt-1 text-sm text-slate-600">
          Personaliza el software para tu inmobiliaria y adapta automáticamente la operación al país.
        </p>
      </div>

      <form onSubmit={save} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
        <div className="md:col-span-2 flex items-center gap-3 border-b border-stone-100 pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Palette className="h-5 w-5" />
          </div>
          <div>
            <div className="font-bold">Marca del cliente</div>
            <div className="text-sm text-slate-500">
              Aplica tanto para SaaS mensual como para licencia dedicada.
            </div>
          </div>
        </div>

        <Field label="Nombre de la inmobiliaria" value={companyName} onChange={setCompanyName} required />
        <div>
          <Field
            label="Nombre del software"
            value={softwareName}
            onChange={setSoftwareName}
            required
            disabled={!whiteLabelAllowed}
          />
          <span className="mt-1 block text-xs text-slate-500">
            {whiteLabelAllowed
              ? 'Tu licencia permite marca blanca y personalización del nombre visible del software.'
              : `La modalidad ${licenseType} conserva la marca del software INMOJCO/JCO. La marca de tu inmobiliaria sí es personalizable.`}
          </span>
        </div>
        <Field label="Sitio web" value={website} onChange={setWebsite} />
        <Field label="Correo comercial" value={email} onChange={setEmail} type="email" />
        <Field label="Teléfono" value={phone} onChange={setPhone} />
        <Field label="WhatsApp" value={whatsapp} onChange={setWhatsapp} />

        <label>
          <span className="mb-1 block text-sm font-medium">País de operación</span>
          <select
            value={country}
            onChange={(e) => handleCountryChange(e.target.value)}
            className="w-full rounded-xl border border-stone-300 px-3 py-2.5"
          >
            {LATAM_COUNTRIES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-sm font-medium">Moneda principal</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full rounded-xl border border-stone-300 px-3 py-2.5"
          >
            <option value={selectedCountry.currency}>
              {selectedCountry.currency} - predeterminada para {selectedCountry.name}
            </option>
            {selectedCountry.currency !== 'USD' && <option value="USD">USD - Dólar estadounidense</option>}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            Se ajusta al cambiar de país, pero puedes usar USD cuando tu operación lo requiera.
          </span>
        </label>

        <label>
          <span className="mb-1 block text-sm font-medium">Formato regional</span>
          <input
            value={selectedCountry.locale}
            readOnly
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-slate-600"
          />
        </label>

        <label>
          <span className="mb-1 block text-sm font-medium">Zona horaria</span>
          <input
            value={timezone}
            readOnly
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-slate-600"
          />
        </label>

        <div className="md:col-span-2 rounded-2xl border border-stone-200 bg-stone-50 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white">
              <FileCheck2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold">Perfil normativo</div>
              <div className="mt-1 text-sm text-slate-600">
                Estado: <strong>{compliance.status}</strong>
                {compliance.version ? ' · versión ' + compliance.version : ''}
              </div>
              {compliance.title && <div className="mt-2 text-sm font-medium">{compliance.title}</div>}
              {compliance.authority && <div className="mt-1 text-xs text-slate-500">{compliance.authority}</div>}
              {compliance.summary && <p className="mt-2 text-xs leading-relaxed text-slate-600">{compliance.summary}</p>}
              {compliance.status === 'REVIEW_REQUIRED' && (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  La configuración regional está activa, pero este país todavía requiere validación jurídica antes de considerar el paquete normativo completo.
                </p>
              )}
            </div>
          </div>
        </div>

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
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-stone-300 px-3 py-2.5 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-slate-500"
      />
    </label>
  );
}
