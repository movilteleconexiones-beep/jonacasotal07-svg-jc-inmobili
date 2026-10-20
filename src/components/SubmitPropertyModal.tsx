// AI Studio resync: source preserved.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Property } from '../data/properties';
import { validatePropertyConsignment, type PropertyConsignmentInput } from '../core/property-consignment';
import { submitPropertyConsignment, usePublicPropertyIntakeSite } from '../lib/property-consignments';
import { X, CheckCircle2 } from 'lucide-react';
import { uploadConsignmentPhoto } from '../lib/consignment-photos';
import type { TenantBrandingState } from '../core/use-tenant-branding';
import { getCountryOption } from '../core/countries';
import { administrativeLabels, loadAdministrativeCatalog, type AdministrativeCatalog } from '../core/location-catalog';

function PhotoThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url ? <img src={url} alt={`Vista previa de ${file.name}`}
    className="h-14 w-16 rounded object-cover" /> : null;
}

interface SubmitPropertyModalProps {
  isOpen: boolean;
  onClose: () => void;
  publicSiteSlug: string;
  branding: Pick<TenantBrandingState, 'companyName' | 'country' | 'currency' | 'locale'>;
}

export const SubmitPropertyModal: React.FC<SubmitPropertyModalProps> = ({
  isOpen,
  onClose,
  publicSiteSlug,
  branding: publicBranding,
}) => {
  const { site, loading: siteLoading, error: siteError } = usePublicPropertyIntakeSite(isOpen, publicSiteSlug);
  const branding = site ? { ...publicBranding, companyName: site.company_name, country: site.country, currency: site.currency } : publicBranding;
  const [submitting, setSubmitting] = useState(false);
  const [contactConsent, setContactConsent] = useState(false);
  const submitLock = useRef(false);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const [title, setTitle] = useState('');
  const configuredCountry = getCountryOption(branding.country || 'CO');
  const [locationCatalog, setLocationCatalog] = useState<AdministrativeCatalog | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [region, setRegion] = useState('');
  const [locality, setLocality] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [operation, setOperation] = useState<Property['operation']>('Venta');
  const [category, setCategory] = useState<Property['category']>('Residencial');
  const [priceCOP, setPriceCOP] = useState('');
  const [landAreaM2, setLandAreaM2] = useState('');
  const [constructionAreaM2, setConstructionAreaM2] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [parkingSpaces, setParkingSpaces] = useState('0');
  const [maintenanceFee, setMaintenanceFee] = useState('0');
  const [constructionYear, setConstructionYear] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [uploadedPhotos, setUploadedPhotos] = useState(0);
  const [photoWarning, setPhotoWarning] = useState('');

  const locationLabels = administrativeLabels(configuredCountry.code);
  const selectedRegion = useMemo(
    () => locationCatalog?.regions.find((item) => item.name === region) ?? null,
    [locationCatalog, region],
  );

  useEffect(() => {
    let active = true;
    setLocationLoading(true);
    setLocationCatalog(null);
    setRegion('');
    setLocality('');

    void loadAdministrativeCatalog(configuredCountry.code).then((catalog) => {
      if (!active) return;
      setLocationCatalog(catalog);
      setLocationLoading(false);
    });

    return () => {
      active = false;
    };
  }, [configuredCountry.code]);

  if (!isOpen) return null;

  // Only resume files not acknowledged by the server; never resubmit the consignment.
  const attemptPhotoUploads = async (reference: string, startIndex: number) => {
    if (!site || !request.current) return;
    setPhotoWarning('');
    for (let i = startIndex; i < photos.length; i++) {
      try {
        await uploadConsignmentPhoto(site.slug, request.current.id, reference, i, photos[i]);
        setUploadedPhotos(i + 1);
      } catch {
        setPhotoWarning(
          `La consignación se recibió, pero solo se confirmaron ${i} de ${photos.length} fotografías. Puedes reintentar las fotos pendientes sin enviar otra solicitud. Si el error continúa, contacta a la inmobiliaria con la referencia.`,
        );
        return;
      }
    }
  };

  const retryPhotoUploads = async () => {
    if (submitLock.current || !createdCode || !site || !request.current || uploadedPhotos >= photos.length) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      await attemptPhotoUploads(createdCode, uploadedPhotos);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    if (!site || siteLoading) {
      setError(siteError || 'Espera a que se conecte la recepción de consignaciones.');
      return;
    }
    if ([priceCOP, landAreaM2, constructionAreaM2, bedrooms, bathrooms, parkingSpaces, maintenanceFee].some(value => !value.trim())) {
      setError('Completa los valores, áreas y cantidades del inmueble.');
      return;
    }
    if (locationLoading || (locationCatalog && !selectedRegion?.localities.some(item => item.name === locality))) {
      setError('Selecciona una ubicación válida de la lista.');
      return;
    }
    const input: PropertyConsignmentInput = {
      title: title.trim(),
      operation_type: operation === 'Venta' ? 'SALE' : operation === 'Renta' ? 'RENT' : 'ADMINISTRATION',
      property_type: category === 'Residencial' ? 'HOUSE' : category === 'Departamento' ? 'APARTMENT' : 'COMMERCIAL',
      price: Number(priceCOP), lot_area: Number(landAreaM2), built_area: Number(constructionAreaM2),
      bedrooms: Number(bedrooms), bathrooms: Number(bathrooms), parking_spaces: Number(parkingSpaces),
      administration_fee: Number(maintenanceFee), construction_year: constructionYear.trim() ? Number(constructionYear) : null,
      state: region.trim(), city: locality.trim(), neighborhood: neighborhood.trim(), description: summary.trim(),
      owner_name: ownerName.trim(), owner_phone: ownerPhone.trim(), contact_consent: contactConsent,
    };
    const validationError = validatePropertyConsignment(input);
    if (validationError) { setError(validationError); return; }
    const signature = JSON.stringify([site.slug, input]);
    if (!request.current || request.current.signature !== signature) {
      request.current = { signature, id: crypto.randomUUID() };
    }
    submitLock.current = true;
    setSubmitting(true);
    setError('');
    try {
      const reference = await submitPropertyConsignment(site.slug, request.current.id, input);
      setCreatedCode(reference);
      await attemptPhotoUploads(reference, 0);
      setOwnerName('');
      setOwnerPhone('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la recepción. Intenta nuevamente.');
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const resetAndClose = () => {
    if (submitLock.current) return;
    request.current = null;
    setContactConsent(false);
    setPriceCOP('');
    setLandAreaM2('');
    setConstructionAreaM2('');
    setBedrooms('');
    setBathrooms('');
    setOperation('Venta');
    setCategory('Residencial');
    setCreatedCode(null);
    setPhotos([]);
    setUploadedPhotos(0);
    setPhotoWarning('');
    setTitle('');
    setSummary('');
    setOwnerName('');
    setOwnerPhone('');
    setNeighborhood('');
    setRegion('');
    setLocality('');
    setParkingSpaces('0');
    setMaintenanceFee('0');
    setConstructionYear('');
    setError('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-property-title"
    >
      <div className="bg-white border border-stone-200 rounded-xl max-w-2xl w-full overflow-hidden shadow-2xl my-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-[#F9F9F7]">
          <div>
            <p className="text-xs text-stone-500">Captación y administración patrimonial · {configuredCountry.name}</p>
            <h2 id="submit-property-title" className="text-xl font-semibold text-slate-900">
              Consignar propiedad con {branding.companyName}
            </h2>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            disabled={submitting}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-stone-200/60 transition-colors"
            aria-label="Cerrar ventana"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {createdCode ? (
          <div className="p-8 space-y-5 text-center">
            <CheckCircle2 className="w-10 h-10 text-[#14532D] mx-auto" />
            <div className="space-y-2">
              <p className="text-xs font-mono-tabular text-stone-500">
                SOLICITUD RECIBIDA · {createdCode}
              </p>
              <h3 className="text-2xl font-semibold text-slate-900">
                Consignación recibida
              </h3>
              {photos.length > 0 && <p aria-live="polite" className="text-sm text-slate-700">Fotografías confirmadas: {uploadedPhotos} de {photos.length}{submitting ? ' · procesando…' : ''}</p>}
              {photoWarning && <div role="alert" className="space-y-2">
                <p className="text-sm text-amber-800">{photoWarning}</p>
                {uploadedPhotos < photos.length && <button type="button" disabled={submitting} onClick={() => void retryPhotoUploads()}
                  className="rounded-lg border border-amber-700 px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50">
                  {submitting ? 'Reintentando…' : 'Reintentar fotografías pendientes'}
                </button>}
              </div>}
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                La solicitud de <strong>{locality}, {region}</strong> quedó guardada para revisión de {branding.companyName}. Conserva la referencia de recepción. La inmobiliaria te contactará para continuar; el inmueble todavía no se ha publicado.
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={resetAndClose}
                className="px-6 py-2.5 bg-[#0F2942] hover:bg-[#163859] text-white text-xs font-medium rounded-lg transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} aria-busy={submitting} className="p-6 space-y-4">
            <fieldset disabled={submitting} className="contents">
            {siteLoading && <p role="status" className="text-sm text-slate-600">Conectando con la inmobiliaria…</p>}
            {siteError && <p role="alert" className="text-sm text-red-700">{siteError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="prop-title" className="block text-xs font-medium text-slate-700 mb-1">
                  Título de la propiedad
                </label>
                <input
                  id="prop-title"
                  maxLength={160}
                  type="text"
                  required
                  placeholder="Ej. Apartamento contemporáneo en El Poblado"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-[#0F2942]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  País
                </label>
                <div className="w-full px-3.5 py-2 bg-stone-50 border border-stone-300 rounded-lg text-sm text-slate-800">
                  {configuredCountry.name}
                </div>
              </div>

              <div>
                <label htmlFor="prop-region" className="block text-xs font-medium text-slate-700 mb-1">
                  {locationLabels.region}
                </label>
                {locationCatalog ? (
                  <select
                    id="prop-region"
                    required
                    value={region}
                    onChange={(e) => {
                      const nextRegion = e.target.value;
                      setRegion(nextRegion);
                      setLocality('');
                    }}
                    disabled={locationLoading}
                    className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-[#0F2942]"
                  >
                    <option value="">Selecciona {locationLabels.region.toLowerCase()}…</option>
                    {locationCatalog.regions.map((item) => (
                      <option key={item.id} value={item.name}>{item.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="prop-region"
                    type="text"
                    required
                    placeholder={locationLabels.region}
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-sm text-slate-900"
                  />
                )}
              </div>

              <div>
                <label htmlFor="prop-locality" className="block text-xs font-medium text-slate-700 mb-1">
                  {locationLabels.locality}
                </label>
                {locationCatalog && selectedRegion ? (
                  <select
                    id="prop-locality"
                    required
                    value={locality}
                    onChange={(e) => setLocality(e.target.value)}
                    disabled={locationLoading}
                    className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-[#0F2942]"
                  >
                    <option value="">Selecciona {locationLabels.locality.toLowerCase()}…</option>
                    {selectedRegion.localities.map((item) => (
                      <option key={item.id} value={item.name}>{item.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="prop-locality"
                    type="text"
                    required
                    placeholder={locationLabels.locality}
                    value={locality}
                    onChange={(e) => setLocality(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-sm text-slate-900"
                  />
                )}
                {locationLoading && (
                  <p className="mt-1 text-[11px] text-stone-500">Cargando división administrativa…</p>
                )}
              </div>

              <div>
                <label htmlFor="prop-zone" className="block text-xs font-medium text-slate-700 mb-1">
                  Barrio / zona / sector
                </label>
                <input
                  id="prop-zone"
                  maxLength={160}
                  type="text"
                  placeholder="Ej. El Poblado, Laureles, Chapinero..."
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-[#0F2942]"
                />
              </div>

              <div>
                <label htmlFor="prop-op" className="block text-xs font-medium text-slate-700 mb-1">
                  Tipo de operación deseada
                </label>
                <select
                  id="prop-op"
                  value={operation}
                  onChange={(e) => setOperation(e.target.value as Property['operation'])}
                  className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-[#0F2942]"
                >
                  <option value="Venta">Promoción en Venta</option>
                  <option value="Renta">Promoción en Renta</option>
                  <option value="Administración">Administración Integral de Inmueble</option>
                </select>
              </div>

              <div>
                <label htmlFor="prop-cat" className="block text-xs font-medium text-slate-700 mb-1">
                  Vocación del inmueble
                </label>
                <select
                  id="prop-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Property['category'])}
                  className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-[#0F2942]"
                >
                  <option value="Residencial">Casa / Residencial</option>
                  <option value="Departamento">Departamento / Penthouse</option>
                  <option value="Comercial y Terreno">Local Comercial / Terreno</option>
                </select>
              </div>

              <div>
                <label htmlFor="prop-price" className="block text-xs font-medium text-slate-700 mb-1">
                  {operation === 'Renta' ? `Renta mensual pretendida (${branding.currency})` : `Valor estimado de venta (${branding.currency})`}
                </label>
                <input
                  id="prop-price"
                  step="0.01"
                  type="number"
                  required
                  value={priceCOP}
                  onChange={(e) => setPriceCOP(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-sm text-slate-900 font-mono-tabular focus:outline-none focus:border-[#0F2942]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-stone-200/80">
              <div>
                <label htmlFor="prop-land" className="block text-xs font-medium text-slate-700 mb-1">
                  Terreno (m²)
                </label>
                <input
                  id="prop-land"
                  step="0.01"
                  type="number"
                  value={landAreaM2}
                  onChange={(e) => setLandAreaM2(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-mono-tabular"
                />
              </div>
              <div>
                <label htmlFor="prop-const" className="block text-xs font-medium text-slate-700 mb-1">
                  Construcción (m²)
                </label>
                <input
                  id="prop-const"
                  step="0.01"
                  type="number"
                  value={constructionAreaM2}
                  onChange={(e) => setConstructionAreaM2(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-mono-tabular"
                />
              </div>
              <div>
                <label htmlFor="prop-beds" className="block text-xs font-medium text-slate-700 mb-1">
                  Recámaras
                </label>
                <input
                  id="prop-beds"
                  type="number"
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-mono-tabular"
                />
              </div>
              <div>
                <label htmlFor="prop-baths" className="block text-xs font-medium text-slate-700 mb-1">
                  Baños
                </label>
                <input
                  id="prop-baths"
                  type="number"
                  step="0.5"
                  value={bathrooms}
                  onChange={(e) => setBathrooms(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-mono-tabular"
                />
              </div>
              <div>
                <label htmlFor="prop-parking" className="block text-xs font-medium text-slate-700 mb-1">
                  Estacionamientos
                </label>
                <input
                  id="prop-parking"
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={parkingSpaces}
                  onChange={(e) => setParkingSpaces(e.target.value)}
                  className="w-full px-3 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-mono-tabular"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="prop-maintenance" className="block text-xs font-medium text-slate-700 mb-1">Cuota de mantenimiento ({branding.currency})</label>
                <input id="prop-maintenance" type="number" min="0" step="0.01" required value={maintenanceFee} onChange={(e) => setMaintenanceFee(e.target.value)} className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm" />
              </div>
              <div>
                <label htmlFor="prop-year" className="block text-xs font-medium text-slate-700 mb-1">Año de construcción (opcional)</label>
                <input id="prop-year" type="number" min="1800" max={new Date().getFullYear()} value={constructionYear} onChange={(e) => setConstructionYear(e.target.value)} className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm" />
              </div>
            </div>

            <div>
              <label htmlFor="prop-summary" className="block text-xs font-medium text-slate-700 mb-1">
                Descripción arquitectónica y equipamiento
              </label>
              <textarea
                id="prop-summary"
                maxLength={2000}
                rows={2}
                placeholder="Describe acabados, estado legal, domótica o necesidades de mantenimiento..."
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-[#0F2942]"
              />
            </div>

            <section aria-label="Fotografías del inmueble" className="space-y-2 rounded-lg border border-stone-200 p-4">
              <label htmlFor="consignment-photos" className="block text-sm font-semibold text-slate-900">Fotografías del inmueble (opcional)</label>
              <p className="text-xs text-slate-600">Adjunta hasta 10 fotografías JPG, PNG o WebP de máximo 5 MB cada una. Se guardarán de forma privada para revisión.</p>
              <input id="consignment-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple
                onChange={e => {
                  const selected = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  const next = [...photos, ...selected];
                  if (next.length > 10 || next.some(f => f.size > 5242880 || f.size < 1 || !['image/jpeg','image/png','image/webp'].includes(f.type))) {
                    setError('Máximo 10 fotografías JPG, PNG o WebP de hasta 5 MB cada una.');
                    return;
                  }
                  setError('');
                  setPhotos(next);
                }}
                className="w-full text-xs text-slate-800 file:mr-3 file:rounded-md file:border file:bg-white file:px-3 file:py-2" />
              {photos.length > 0 && <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {photos.map((file, index) => <li key={index} className="flex items-center justify-between gap-2 rounded-md bg-stone-50 p-2 text-xs">
                  <div className="flex min-w-0 items-center gap-2"><PhotoThumbnail file={file} /><span className="truncate" title={file.name}>{index + 1}. {file.name}</span></div>
                  <button type="button" onClick={() => setPhotos(current => current.filter((_,i) => i !== index))}
                    aria-label={`Eliminar fotografía ${index + 1}`} className="rounded p-1 text-red-700">Quitar</button>
                </li>)}
              </ul>}
            </section>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-stone-200/80">
              <div>
                <label htmlFor="owner-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Nombre del propietario o apoderado
                </label>
                <input
                  id="owner-name"
                  maxLength={120}
                  type="text"
                  required
                  placeholder="Nombre y apellido"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-xs text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="owner-phone" className="block text-xs font-medium text-slate-700 mb-1">
                  Teléfono de contacto
                </label>
                <input
                  id="owner-phone"
                  maxLength={40}
                  type="tel"
                  required
                  placeholder="+57 300 123 4567"
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-xs text-slate-900 font-mono-tabular"
                />
              </div>
            </div>

            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={contactConsent} onChange={e => setContactConsent(e.target.checked)} required className="mt-0.5" />
              <span>Autorizo a {branding.companyName} a usar mi nombre y teléfono para atender esta solicitud de consignación.</span>
            </label>
            <p className="text-[11px] leading-relaxed text-stone-500">
              {branding.companyName} es responsable de la atención de esta solicitud y de los servicios, contratos, pólizas, avalúos y verificaciones que decida ofrecer. La plataforma tecnológica no garantiza esos servicios.
            </p>

            {error && <p role="alert" className="text-xs text-red-700 font-medium">{error}</p>}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-stone-200">
              <button
                type="button"
                onClick={resetAndClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting || siteLoading || !site || locationLoading}
                className="px-5 py-2.5 bg-[#0F2942] hover:bg-[#163859] text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
              >
                {submitting ? 'Enviando solicitud…' : 'Enviar consignación'}
              </button>
            </div>
            </fieldset>
          </form>
        )}
      </div>
    </div>
  );
};
