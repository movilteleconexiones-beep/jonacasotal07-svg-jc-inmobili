import { etiquetaES } from '../../core/etiquetas-es';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FileCheck2, Palette, Save } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { getCountryOption, LATAM_COUNTRIES } from '../../core/countries';
import { useTenantBranding } from '../../core/use-tenant-branding';
import { paletteFromLogoUrl, safeBrandUrl, safeTenantColor, TENANT_DEFAULT_PRIMARY, TENANT_DEFAULT_SECONDARY } from '../../core/tenant-palette';
import { supabase } from '../../lib/supabase';
import type { PublicAgencyService } from '../../core/public-agency-content';
import { parsePublicPageContent, validPublicPageContent, type PublicPageContent } from '../../core/public-page-content';
import { tenantPublicPath } from '../../core/public-tenant-route';
import { isValidTenantSlug, normalizeTenantSlug, tenantPrivatePath } from '../../core/tenant-links';

interface ComplianceInfo {
  status: string;
  title?: string;
  version?: string;
  authority?: string;
  summary?: string;
}

export function SettingsModule() {
  const { activeMembership, can, refreshMemberships } = useAuth();
  const { branding, refresh } = useTenantBranding();
  const organizationId = activeMembership?.organization.id;

  const [companyName, setCompanyName] = useState('');
  const [publicSlug, setPublicSlug] = useState('');
  const [slugSaving, setSlugSaving] = useState(false);
  const [softwareName, setSoftwareName] = useState('');
  const [publicHeadline, setPublicHeadline] = useState('');
  const [publicDescription, setPublicDescription] = useState('');
  const [publicHeroUrl, setPublicHeroUrl] = useState('');
  const [publicOfficeAddress, setPublicOfficeAddress] = useState('');
  const [publicServices, setPublicServices] = useState<PublicAgencyService[]>([]);
  const [publicPage, setPublicPage] = useState<PublicPageContent>(parsePublicPageContent(null));
  const [website, setWebsite] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState(TENANT_DEFAULT_PRIMARY);
  const [secondaryColor, setSecondaryColor] = useState(TENANT_DEFAULT_SECONDARY);
  const [sampling, setSampling] = useState(false);
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
  const isOwner = Boolean(activeMembership?.roles.some(role => role.key === 'ORGANIZATION_OWNER' && role.active));
  const currentSlug = activeMembership?.organization.slug || '';

  useEffect(() => { setPublicSlug(currentSlug); }, [organizationId, currentSlug]);

  useEffect(() => {
    setCompanyName(branding.companyName);
    setSoftwareName(branding.softwareName);
    setPublicHeadline(branding.publicHeadline ?? '');
    setPublicDescription(branding.publicDescription ?? '');
    setPublicHeroUrl(branding.publicHeroUrl ?? '');
    setPublicOfficeAddress(branding.publicOfficeAddress ?? '');
    setPublicServices(branding.publicServices);
    setPublicPage(branding.publicPage);
    setWebsite(branding.website ?? '');
    setLogoUrl(branding.logoUrl ?? '');
    setPrimaryColor(safeTenantColor(branding.primaryColor, TENANT_DEFAULT_PRIMARY));
    setSecondaryColor(safeTenantColor(branding.secondaryColor, TENANT_DEFAULT_SECONDARY));
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

  async function adaptLogoColors() {
    if (!can('settings.edit') || !logoUrl.trim() || sampling) return;
    setSampling(true);
    setMessage('');
    try {
      const palette = await paletteFromLogoUrl(logoUrl);
      setPrimaryColor(palette.primary);
      setSecondaryColor(palette.secondary);
      setMessage('Colores detectados. Comprueba la vista previa y pulsa Guardar configuración.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No fue posible analizar el logo.');
    } finally { setSampling(false); }
  }

  async function savePublicSlug() {
    if (!organizationId || !isOwner || !can('settings.edit') || slugSaving) return;
    const desiredSlug = publicSlug.trim().toLowerCase();
    if (!isValidTenantSlug(desiredSlug)) {
      setMessage('La dirección debe tener de 2 a 60 caracteres y usar letras minúsculas, números y guiones.');
      return;
    }
    if (desiredSlug === currentSlug) {
      setMessage('La URL ya corresponde a esta inmobiliaria.');
      return;
    }
    if (!window.confirm('Cambiar la URL invalidará los enlaces públicos anteriores. ¿Deseas continuar?')) return;
    setSlugSaving(true);
    setMessage('');
    try {
      const { data, error } = await supabase.rpc('set_organization_public_slug', {
        target_org: organizationId,
        desired_slug: desiredSlug,
      });
      if (error) throw error;
      const confirmedSlug = String(data);
      // Keep the user's private shortcut consistent before reloading memberships.
      if (window.location.pathname === '/app') {
        window.history.replaceState(window.history.state, '', tenantPrivatePath(confirmedSlug));
      }
      await refreshMemberships();
      setPublicSlug(confirmedSlug);
      setMessage('URL actualizada. Usa el nuevo enlace para compartir tu portal.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo actualizar la URL.');
    } finally {
      setSlugSaving(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !can('settings.edit')) return;
    if (website.trim() && !safeBrandUrl(website)) {
      setMessage('El sitio web debe empezar por https:// y ser una dirección válida.');
      return;
    }
    if (logoUrl.trim() && !safeBrandUrl(logoUrl)) {
      setMessage('El logo debe estar alojado en una dirección HTTPS válida.');
      return;
    }
    if (publicHeroUrl.trim() && !safeBrandUrl(publicHeroUrl)) {
      setMessage('La portada necesita una imagen HTTPS pública válida.');
      return;
    }
    if (publicHeadline.trim().length > 160 || publicDescription.trim().length > 700 || publicOfficeAddress.trim().length > 220) {
      setMessage('Revisa los límites del título (160), descripción (700) y dirección de atención (220).');
      return;
    }
    if (!validPublicPageContent(publicPage)) {
      setMessage('Revisa los límites de texto de las secciones de tu portal público.');
      return;
    }
    if (publicServices.length > 8 || publicServices.some(item =>
      !item.title.trim() || !item.description.trim() ||
      item.title.trim().length > 90 || item.description.trim().length > 420)) {
      setMessage('Cada servicio requiere título (máximo 90 caracteres) y descripción (máximo 420). Admite hasta 8 servicios.');
      return;
    }
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
          public_headline: publicHeadline.trim() || null,
          public_description: publicDescription.trim() || null,
          public_hero_url: publicHeroUrl.trim() ? safeBrandUrl(publicHeroUrl) : null,
          public_office_address: publicOfficeAddress.trim() || null,
          public_services: publicServices.map(s => ({ title: s.title.trim(), description: s.description.trim() })),
          public_page_content: publicPage,
          software_name: softwareName.trim(),
          website: website.trim() ? safeBrandUrl(website) : null,
          logo_url: logoUrl.trim() ? safeBrandUrl(logoUrl) : null,
          primary_color: safeTenantColor(primaryColor, TENANT_DEFAULT_PRIMARY),
          secondary_color: safeTenantColor(secondaryColor, TENANT_DEFAULT_SECONDARY),
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
      await refreshMemberships();
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
        <h1 className="text-2xl font-bold">Personaliza tu inmobiliaria</h1>
        <p className="mt-1 text-sm text-slate-600">
          Empieza por el nombre, el logo y tu portada. Todo lo demás es opcional.
        </p>
      </div>

      <form onSubmit={save} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
        <div className="md:col-span-2 flex items-center gap-3 border-b border-stone-100 pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Palette className="h-5 w-5" />
          </div>
          <div>
            <div className="font-bold">Tu marca</div>
            <div className="text-sm text-slate-500">
              El nombre y la identidad que verán tus clientes.
            </div>
          </div>
        </div>

        <div className="md:col-span-2"><Field label="Nombre de la inmobiliaria" value={companyName} onChange={setCompanyName} required /></div>
        <div className="md:col-span-2 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="font-semibold">Tu enlace público</div>
          <p className="mt-1 text-xs text-slate-600">INMOJCO lo administra automáticamente. Compártelo con tus clientes cuando tu portal esté activo.</p>
          <a href={tenantPublicPath(currentSlug)} target="_blank" rel="noopener noreferrer"
             className="mt-2 inline-block max-w-full break-all text-sm font-semibold text-slate-900 underline underline-offset-4">
            {window.location.origin}{tenantPublicPath(currentSlug)}
          </a>
        </div>



        <div className="md:col-span-2 rounded-xl border border-stone-200 bg-white p-4">
          <div className="font-semibold">Logo y colores de tu inmobiliaria</div>
          <p className="mt-1 text-xs text-slate-600">Tu logo se mostrará en la cabecera del panel inmobiliario, sin cambiar la marca de INMOJCO ni la administración central.</p>
          <div className="mt-3">
            <Field label="Dirección HTTPS de la imagen del logo" value={logoUrl} onChange={setLogoUrl} type="url" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <div className="flex h-20 w-28 items-center justify-center overflow-hidden rounded-xl border bg-white">
              {safeBrandUrl(logoUrl) ? <img src={safeBrandUrl(logoUrl) ?? ''} alt="Vista previa del logo" className="max-h-full max-w-full object-contain p-2" /> :
                <span className="text-center text-xs text-slate-500">Sin logo</span>}
            </div>
            <button type="button" onClick={() => void adaptLogoColors()} disabled={sampling || saving || !can('settings.edit') || !safeBrandUrl(logoUrl)} className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {sampling ? 'Analizando logo…' : 'Adaptar colores al logo'}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Si el servidor de la imagen impide leer sus colores, puedes elegirlos manualmente. El logo debe ser accesible públicamente mediante HTTPS.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Color principal
              <input aria-label="Color principal de la inmobiliaria" type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="mt-2 block h-11 w-full cursor-pointer rounded-lg border" />
            </label>
            <label className="text-sm font-medium">Color de fondo suave
              <input aria-label="Color secundario de la inmobiliaria" type="color" value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} className="mt-2 block h-11 w-full cursor-pointer rounded-lg border" />
            </label>
          </div>
          <div className="mt-4 rounded-xl p-4 text-sm font-semibold" style={{ backgroundColor: secondaryColor, color: primaryColor, borderLeft: '5px solid ' + primaryColor }}>
            Vista previa de la identidad de tu inmobiliaria
          </div>
        </div>
        <div className="md:col-span-2 rounded-xl border border-stone-200 bg-stone-50 p-4 space-y-4">
          <div className="font-semibold">Portada pública de esta inmobiliaria</div>
          <p className="text-xs text-slate-600">Estos textos y servicios aparecen solo en el sitio público de tu inmobiliaria. Si no declaras un servicio, no se anunciará. El panel de SuperAdmin no se modifica.</p>
          <Field label="Título principal de la portada" value={publicHeadline} onChange={setPublicHeadline} />
          <label className="block text-sm font-medium">Presentación comercial de tu inmobiliaria
            <textarea aria-label="Descripción de la portada pública" maxLength={700} rows={3}
              className="mt-2 block w-full rounded-xl border border-stone-300 px-3 py-2.5"
              value={publicDescription} onChange={e => setPublicDescription(e.target.value)} />
          </label>
          <Field label="Imagen principal de la portada (URL HTTPS)" type="url" value={publicHeroUrl} onChange={setPublicHeroUrl} />
          <Field label="Dirección de atención pública (opcional)" value={publicOfficeAddress} onChange={setPublicOfficeAddress} />
          <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
            <div>
              <h3 className="font-semibold">Secciones de tu portal público</h3>
              <p className="mt-1 text-xs text-slate-600">Modifica títulos y textos, y decide qué secciones estarán visibles. Los cambios son exclusivos de tu inmobiliaria y se publican al guardar.</p>
            </div>
            <Field label="Lema sobre la portada (máx. 130)" value={publicPage.introLabel}
              onChange={value => setPublicPage(current => ({...current, introLabel:value}))} maxLength={130} />
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ['showCatalog','Catálogo de propiedades'],
                ['showServices','Servicios ofrecidos'],
                ['showCalculator','Calculadora de estimaciones'],
                ['showContact','Información y formulario de contacto'],
              ] as const).map(([key,title]) => (
                <label key={key} className="flex items-center gap-3 rounded-lg border border-stone-200 px-3 py-2 text-sm">
                  <input type="checkbox" checked={publicPage[key]} disabled={!can('settings.edit')}
                    onChange={event => setPublicPage(current => ({...current,[key]:event.target.checked}))}
                    className="h-4 w-4" />
                  <span>Mostrar {title.toLowerCase()}</span>
                </label>
              ))}
            </div>
            <Field label="Título del catálogo (máx. 130)" value={publicPage.catalogTitle}
              onChange={value=>setPublicPage(current=>({...current,catalogTitle:value}))} maxLength={130} />
            <Field label="Título de servicios (máx. 130)" value={publicPage.servicesTitle}
              onChange={value=>setPublicPage(current=>({...current,servicesTitle:value}))} maxLength={130} />
            <label className="block text-sm font-medium">Descripción de servicios
              <textarea maxLength={420} rows={2} value={publicPage.servicesDescription}
                onChange={event=>setPublicPage(current=>({...current,servicesDescription:event.target.value}))}
                className="mt-2 block w-full rounded-xl border border-stone-300 p-3" />
            </label>
            <Field label="Título de contacto (máx. 130)" value={publicPage.contactTitle}
              onChange={value=>setPublicPage(current=>({...current,contactTitle:value}))} maxLength={130} />
            <label className="block text-sm font-medium">Presentación de contacto
              <textarea maxLength={420} rows={2} value={publicPage.contactDescription}
                onChange={event=>setPublicPage(current=>({...current,contactDescription:event.target.value}))}
                className="mt-2 block w-full rounded-xl border border-stone-300 p-3" />
            </label>
            <label className="block text-sm font-medium">Texto comercial del pie de página (opcional)
              <textarea maxLength={420} rows={2} value={publicPage.footerDescription}
                onChange={event=>setPublicPage(current=>({...current,footerDescription:event.target.value}))}
                className="mt-2 block w-full rounded-xl border border-stone-300 p-3" />
              <span className="mt-1 block text-xs text-slate-500">El aviso de responsabilidad de la inmobiliaria seguirá visible.</span>
            </label>
          </div>
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <div className="px-4 py-3 text-sm font-semibold">Vista previa antes de guardar</div>
            <div className="space-y-2 p-5 text-white" style={{background:primaryColor}}>
              <div className="text-xs">{publicPage.introLabel.trim() || selectedCountry.name+' · Portal inmobiliario'}</div>
              <h3 className="text-xl font-bold">{publicHeadline.trim() || 'Bienvenido a '+companyName}</h3>
              <p className="text-sm">{publicDescription.trim() || 'Explora el portafolio de '+companyName}</p>
            </div>
            <div className="flex flex-wrap gap-2 p-4 text-xs font-medium">
              {publicPage.showCatalog && <span className="rounded border px-3 py-2">{publicPage.catalogTitle || 'Catálogo'}</span>}
              {publicPage.showServices && <span className="rounded border px-3 py-2">{publicPage.servicesTitle || 'Servicios'}</span>}
              {publicPage.showCalculator && <span className="rounded border px-3 py-2">Calculadora</span>}
              {publicPage.showContact && <span className="rounded border px-3 py-2">{publicPage.contactTitle || 'Contacto'}</span>}
            </div>
            <p className="px-4 pb-4 text-xs text-slate-500">Vista orientativa. Guarda y abre la portada pública para comprobar el resultado real.</p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Servicios que realmente ofrece esta inmobiliaria</div>
              <p className="text-xs text-slate-500">Hasta ocho, con descripciones propias. No se publican promesas, casos de éxito ni capacitaciones de otras empresas.</p>
            </div>
            <button type="button" disabled={!can('settings.edit') || publicServices.length >= 8}
              onClick={() => setPublicServices(current => [...current, { title: '', description: '' }])}
              className="shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40">
              Añadir servicio
            </button>
          </div>
          {publicServices.length === 0 && <p className="text-xs text-amber-800">Todavía no has publicado servicios. La portada invitará al visitante a consultar directamente.</p>}
          {publicServices.map((service, index) => (
            <div key={index} className="space-y-2 rounded-xl border bg-white p-3">
              <label className="block text-xs font-semibold">Servicio {index + 1}
                <input maxLength={90} value={service.title}
                  onChange={e => setPublicServices(items => items.map((item, i) => i === index ? { ...item, title: e.target.value } : item))}
                  placeholder="Ej. Administración de arriendos"
                  className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs font-semibold">Descripción que se mostrará al público
                <textarea maxLength={420} rows={2} value={service.description}
                  onChange={e => setPublicServices(items => items.map((item, i) => i === index ? { ...item, description: e.target.value } : item))}
                  className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm" />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" disabled={index===0} onClick={() => setPublicServices(items => {
                  const next=[...items];[next[index-1],next[index]]=[next[index],next[index-1]];return next;
                })} className="text-xs font-semibold underline disabled:opacity-40">Subir</button>
                <button type="button" disabled={index===publicServices.length-1} onClick={() => setPublicServices(items => {
                  const next=[...items];[next[index],next[index+1]]=[next[index+1],next[index]];return next;
                })} className="text-xs font-semibold underline disabled:opacity-40">Bajar</button>
                <button type="button" onClick={() => setPublicServices(items => items.filter((_, i) => i !== index))}
                  className="text-xs font-semibold text-red-700 underline">Retirar servicio</button>
              </div>
            </div>
          ))}
          <a href={tenantPublicPath(activeMembership?.organization.slug || '')} target="_blank" rel="noopener noreferrer"
            className="inline-block text-sm font-semibold underline">Ver mi portada pública</a>
        </div>
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
                Estado: <strong>{etiquetaES(compliance.status)}</strong>
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

        <details className="md:col-span-2 rounded-xl border border-stone-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">Opciones avanzadas (opcionales)</summary>
          <p className="mt-2 text-xs text-slate-600">No necesitas cambiar estos datos para usar tu inmobiliaria. Modificar la URL puede invalidar enlaces compartidos.</p>
          <div className="mt-4 space-y-4">
            <div className="space-y-3 rounded-lg bg-stone-50 p-4">
              <h3 className="font-semibold">Administrar mis direcciones</h3>
              <p className="break-all text-xs"><strong>Acceso privado:</strong> <a className="underline" href={tenantPrivatePath(currentSlug)}>{window.location.origin}{tenantPrivatePath(currentSlug)}</a></p>
              <label className="block text-sm font-medium">Cambiar identificador del enlace
                <input value={publicSlug} maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  onChange={event=>setPublicSlug(normalizeTenantSlug(event.target.value))}
                  disabled={!isOwner || !can('settings.edit') || slugSaving}
                  className="mt-2 block w-full rounded-xl border border-stone-300 p-3 disabled:bg-stone-100"
                  aria-label="Identificador público de la inmobiliaria" />
              </label>
              <button type="button" onClick={()=>void savePublicSlug()}
                disabled={!isOwner || !can('settings.edit') || slugSaving || publicSlug===currentSlug}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {slugSaving ? 'Actualizando URL…' : 'Cambiar URL pública'}
              </button>
              {!isOwner && <p className="text-xs text-slate-600">Solo el titular de la inmobiliaria puede cambiar esta URL.</p>}
            </div>
            <div className="space-y-2 rounded-lg bg-stone-50 p-4">
              <h3 className="font-semibold">Sitio web externo</h3>
              <Field label="Dirección HTTPS de tu sitio web (opcional)" value={website} onChange={setWebsite} type="url" />
              <p className="text-xs text-slate-600">Añadir un enlace no conecta automáticamente un dominio externo. Eso requiere verificar DNS y HTTPS.</p>
            </div>
            <div className="space-y-2 rounded-lg bg-stone-50 p-4">
              <Field label="Nombre del software (marca blanca)" value={softwareName} onChange={setSoftwareName} disabled={!whiteLabelAllowed} />
              <p className="text-xs text-slate-600">
                {whiteLabelAllowed ? 'Tu licencia permite editar la marca del software.' :
                 `Tu licencia ${licenseType} mantiene la marca de INMOJCO; el nombre de tu inmobiliaria sí es personalizable.`}
              </p>
            </div>
          </div>
        </details>
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
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
}) {
  return (
    <label>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-stone-300 px-3 py-2.5 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-slate-500"
      />
    </label>
  );
}
