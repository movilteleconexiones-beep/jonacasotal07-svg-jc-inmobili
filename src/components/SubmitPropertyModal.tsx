// AI Studio resync: source preserved.
import React, { useEffect, useMemo, useState } from 'react';
import { Property, ZONE_VALUATION_BENCHMARKS, HERO_IMAGE } from '../data/properties';
import propSolaresHouse from '../assets/images/prop_solares_house_1791081961290.jpg';
import { X, CheckCircle2 } from 'lucide-react';
import { useTenantBranding } from '../core/use-tenant-branding';
import { getCountryOption } from '../core/countries';
import { administrativeLabels, loadAdministrativeCatalog, type AdministrativeCatalog } from '../core/location-catalog';

interface SubmitPropertyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddProperty: (newProp: Property) => void;
}

export const SubmitPropertyModal: React.FC<SubmitPropertyModalProps> = ({
  isOpen,
  onClose,
  onAddProperty
}) => {
  const { branding } = useTenantBranding();
  const [title, setTitle] = useState('');
  const configuredCountry = getCountryOption(branding.country || 'CO');
  const [locationCatalog, setLocationCatalog] = useState<AdministrativeCatalog | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [region, setRegion] = useState('');
  const [locality, setLocality] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [operation, setOperation] = useState<Property['operation']>('Venta');
  const [category, setCategory] = useState<Property['category']>('Residencial');
  const [priceCOP, setPriceCOP] = useState('450000000');
  const [landAreaM2, setLandAreaM2] = useState('300');
  const [constructionAreaM2, setConstructionAreaM2] = useState('360');
  const [bedrooms, setBedrooms] = useState('3');
  const [bathrooms, setBathrooms] = useState('3.5');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);

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
      const firstRegion = catalog?.regions[0];
      if (firstRegion) {
        setRegion(firstRegion.name);
        setLocality(firstRegion.localities[0]?.name ?? '');
      }
      setLocationLoading(false);
    });

    return () => {
      active = false;
    };
  }, [configuredCountry.code]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 5) {
      setError('Ingresa un título descriptivo para el inmueble.');
      return;
    }
    const phoneDigits = ownerPhone.replace(/\D/g, '');
    if (ownerName.trim().length < 3 || phoneDigits.length < 7 || phoneDigits.length > 15) {
      setError('Por favor proporciona tu nombre y un teléfono válido, con código de país cuando corresponda.');
      return;
    }

    const numericPrice = Math.max(1000000, Number(priceCOP) || 450000000);
    const numericLand = Math.max(60, Number(landAreaM2) || 200);
    const numericConst = Math.max(60, Number(constructionAreaM2) || 220);
    if (!region.trim() || !locality.trim()) {
      setError(`Selecciona ${locationLabels.region.toLowerCase()} y ${locationLabels.locality.toLowerCase()}.`);
      return;
    }

    const benchmark =
      ZONE_VALUATION_BENCHMARKS[neighborhood.trim()] ??
      ZONE_VALUATION_BENCHMARKS[locality.trim()] ?? {
        avgPricePerM2MXN: 0,
        annualAppreciationPct: 8,
        avgDaysToLease: 30,
        avgYieldPct: 6,
      };
    const generatedCode = `JCO-${Math.floor(7000 + Math.random() * 2000)}`;

    const newProperty: Property = {
      id: `prop-custom-${Date.now()}`,
      code: generatedCode,
      title: title.trim(),
      neighborhood: neighborhood.trim() || locality.trim(),
      municipality: `${locality.trim()}, ${region.trim()}`,
      countryCode: configuredCountry.code,
      region: region.trim(),
      city: locality.trim(),
      operation,
      category,
      priceCOP: operation === 'Renta' ? numericPrice * 180 : numericPrice,
      monthlyRentEstimationCOP:
        operation === 'Renta'
          ? numericPrice
          : Math.round((numericPrice * (benchmark.avgYieldPct / 100)) / 12),
      maintenanceFeeCOP: 500000,
      landAreaM2: numericLand,
      constructionAreaM2: numericConst,
      bedrooms: Number(bedrooms) || 3,
      bathrooms: Number(bathrooms) || 3,
      parkingSpaces: 3,
      annualAppreciationPct: benchmark.annualAppreciationPct,
      rentalYieldPct: benchmark.avgYieldPct,
      image: HERO_IMAGE,
      secondaryImage: propSolaresHouse,
      legalStatus: `Expediente en revisión documental por ${branding.companyName} y/o proveedor profesional autorizado`,
      architecturalSummary:
        summary.trim() ||
        `Propiedad consignada en ${locality}, ${region}, ${configuredCountry.name} bajo gestión de ${branding.companyName}. Cuenta con revisión documental en curso y disponibilidad para citas.`,
      highlights: [
        `Ubicación estratégica en ${locality}, ${region}`,
        `Revisión documental y valoración comercial gestionadas por ${branding.companyName} y/o proveedor autorizado`,
        `Promoción multicanal en portales especializados en ${configuredCountry.name}`
      ],
      domoticsAndMaintenance: [
        `Servicios de mantenimiento sujetos a contratación y condiciones de ${branding.companyName} o su proveedor`,
        'Diagnóstico técnico sujeto a disponibilidad, alcance contratado y proveedor responsable'
      ],
      coordinatesLabel: `${neighborhood.trim() ? neighborhood.trim() + ' · ' : ''}${locality}, ${region} · ${configuredCountry.name}`,
      yearBuilt: 2024
    };

    onAddProperty(newProperty);
    setError('');
    setCreatedCode(generatedCode);
  };

  const resetAndClose = () => {
    setCreatedCode(null);
    setTitle('');
    setSummary('');
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
                EXPEDIENTE REGISTRADO · CLAVE {createdCode}
              </p>
              <h3 className="text-2xl font-semibold text-slate-900">
                Propiedad Incorporada al Catálogo Activo
              </h3>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                Tu propiedad en <strong>{locality}, {region}</strong> ya aparece publicada en el catálogo interactivo y ha sido asignada a un asesor para validación documental.
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={resetAndClose}
                className="px-6 py-2.5 bg-[#0F2942] hover:bg-[#163859] text-white text-xs font-medium rounded-lg transition-colors"
              >
                Ver Propiedad en el Catálogo
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="prop-title" className="block text-xs font-medium text-slate-700 mb-1">
                  Título de la propiedad
                </label>
                <input
                  id="prop-title"
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
                    value={region}
                    onChange={(e) => {
                      const nextRegion = e.target.value;
                      setRegion(nextRegion);
                      const next = locationCatalog.regions.find((item) => item.name === nextRegion);
                      setLocality(next?.localities[0]?.name ?? '');
                    }}
                    disabled={locationLoading}
                    className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-[#0F2942]"
                  >
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
                    value={locality}
                    onChange={(e) => setLocality(e.target.value)}
                    disabled={locationLoading}
                    className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-[#0F2942]"
                  >
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
            </div>

            <div>
              <label htmlFor="prop-summary" className="block text-xs font-medium text-slate-700 mb-1">
                Descripción arquitectónica y equipamiento
              </label>
              <textarea
                id="prop-summary"
                rows={2}
                placeholder="Describe acabados, estado legal, domótica o necesidades de mantenimiento..."
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-[#0F2942]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-stone-200/80">
              <div>
                <label htmlFor="owner-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Nombre del propietario o apoderado
                </label>
                <input
                  id="owner-name"
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
                  type="tel"
                  required
                  placeholder="+57 300 123 4567"
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-stone-300 rounded-lg text-xs text-slate-900 font-mono-tabular"
                />
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-stone-500">
              La inmobiliaria usuaria es responsable de la información publicada, validaciones, contratos,
              seguros, pólizas, avalúos y servicios profesionales asociados al inmueble. INMOJCO actúa como
              proveedor de la plataforma tecnológica.
            </p>

            {error && <p className="text-xs text-red-700 font-medium">{error}</p>}

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
                className="px-5 py-2.5 bg-[#0F2942] hover:bg-[#163859] text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
              >
                Registrar y Publicar Inmueble
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
