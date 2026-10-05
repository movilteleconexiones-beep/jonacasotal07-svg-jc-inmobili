// AI Studio resync: source preserved.
import React, { useState } from 'react';
import { Property } from '../data/properties';
import { ResilientImage } from './ResilientImage';
import { X, Check, Calendar, PhoneCall, Bookmark } from 'lucide-react';
import { useTenantBranding } from '../core/use-tenant-branding';

interface PropertyDetailModalProps {
  property: Property | null;
  onClose: () => void;
  isSaved: boolean;
  onToggleSave: (id: string) => void;
  onScheduleVisit: (property: Property, visitData: { name: string; phone: string; date: string; modality: string }) => void;
}

export const PropertyDetailModal: React.FC<PropertyDetailModalProps> = ({
  property,
  onClose,
  isSaved,
  onToggleSave,
  onScheduleVisit
}) => {
  const { branding } = useTenantBranding();
  const [activePhotoIndex, setActivePhotoIndex] = useState<0 | 1>(0);
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [visitDate, setVisitDate] = useState('2026-10-08');
  const [visitModality, setVisitModality] = useState<'Recorrido en Propiedad' | 'Cita en oficina principal' | 'Videollamada Ejecutiva'>('Recorrido en Propiedad');
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState('');

  if (!property) return null;

  const formatMoney = (val: number) =>
    new Intl.NumberFormat(branding.locale || 'es-CO', {
      style: 'currency',
      currency: branding.currency || 'COP',
      maximumFractionDigits: 0
    }).format(val);

  const photos = [property.image, property.secondaryImage];
  const pricePerM2 = Math.round(property.priceCOP / property.constructionAreaM2);

  const handleBookingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (visitorName.trim().length < 3) {
      setFormError('Por favor ingresa tu nombre completo.');
      return;
    }
    const phoneDigits = visitorPhone.replace(/\D/g, '');
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      setFormError('Ingresa un teléfono válido con código de país cuando corresponda.');
      return;
    }
    setFormError('');
    setSubmitted(true);
    onScheduleVisit(property, {
      name: visitorName.trim(),
      phone: visitorPhone.trim(),
      date: visitDate,
      modality: visitModality
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4 md:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-property-title"
    >
      <div className="bg-white border border-stone-200 rounded-xl max-w-[1120px] w-full overflow-hidden shadow-2xl my-auto max-h-[92vh] flex flex-col">
        {/* Top Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-[#F9F9F7] shrink-0">
          <div className="flex items-center gap-2 text-xs text-stone-600">
            <span className="font-mono-tabular font-semibold text-slate-900">{property.code}</span>
            <span aria-hidden="true">·</span>
            <span>{property.neighborhood}, {property.municipality}</span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-[#0F2942]">{property.operation}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onToggleSave(property.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                isSaved
                  ? 'bg-[#0F2942] text-white border-[#0F2942]'
                  : 'bg-white text-slate-700 border-stone-300 hover:border-slate-900'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>{isSaved ? 'Guardada en Portafolio' : 'Guardar Ficha'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-stone-200/60 transition-colors"
              aria-label="Cerrar expediente"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Contiguous Purchase / Inspection Module */}
        <div className="grid grid-cols-1 lg:grid-cols-12 overflow-y-auto divide-y lg:divide-y-0 lg:divide-x divide-stone-200">
          {/* Left 7 Columns: Visual Gallery & Architectural Dossier */}
          <div className="lg:col-span-7 p-6 space-y-6">
            <div className="relative aspect-4/3 w-full rounded-lg overflow-hidden bg-stone-100 border border-stone-200">
              <ResilientImage
                src={photos[activePhotoIndex]}
                alt={property.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-slate-950/75 backdrop-blur-xs p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setActivePhotoIndex(0)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    activePhotoIndex === 0 ? 'bg-white text-slate-900' : 'text-stone-200 hover:text-white'
                  }`}
                >
                  Vista Principal
                </button>
                <button
                  type="button"
                  onClick={() => setActivePhotoIndex(1)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    activePhotoIndex === 1 ? 'bg-white text-slate-900' : 'text-stone-200 hover:text-white'
                  }`}
                >
                  Vista Secundaria
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs text-stone-500 mb-1">
                {property.coordinatesLabel} · Construida en {property.yearBuilt}
              </p>
              <h2
                id="modal-property-title"
                className="text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight balance-text"
              >
                {property.title}
              </h2>
              <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                {property.architecturalSummary}
              </p>
            </div>

            {/* Tabular Technical Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-y border-stone-200 text-left">
              <div>
                <p className="text-xs text-stone-500">Superficie Terreno</p>
                <p className="text-base font-semibold text-slate-900 font-mono-tabular mt-0.5">
                  {property.landAreaM2} m²
                </p>
              </div>
              <div>
                <p className="text-xs text-stone-500">Construcción</p>
                <p className="text-base font-semibold text-slate-900 font-mono-tabular mt-0.5">
                  {property.constructionAreaM2} m²
                </p>
              </div>
              <div>
                <p className="text-xs text-stone-500">Distribución</p>
                <p className="text-base font-semibold text-slate-900 font-mono-tabular mt-0.5">
                  {property.bedrooms} Rec · {property.bathrooms} Baños
                </p>
              </div>
              <div>
                <p className="text-xs text-stone-500">Plusvalía Anual</p>
                <p className="text-base font-semibold text-[#14532D] font-mono-tabular mt-0.5">
                  +{property.annualAppreciationPct}% / año
                </p>
              </div>
            </div>

            {/* Architectural & Legal Highlights */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 tracking-wide mb-2.5">
                  Atributos Arquitectónicos y Ubicación
                </h3>
                <ul className="space-y-2 text-xs text-slate-600">
                  {property.highlights.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-[#0F2942] font-bold">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-900 tracking-wide mb-2.5">
                  Equipamiento, Domótica y Conservación JC
                </h3>
                <ul className="space-y-2 text-xs text-slate-600">
                  {property.domoticsAndMaintenance.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-[#14532D] font-bold">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Right 5 Columns: Sticky Financial Summary & Direct Visit Scheduler */}
          <div className="lg:col-span-5 p-6 bg-[#F9F9F7] flex flex-col justify-between space-y-6">
            <div className="space-y-5">
              <div className="pb-4 border-b border-stone-200">
                <p className="text-xs text-stone-500 mb-1">
                  {property.operation === 'Renta'
                    ? 'Renta Mensual con Póliza Sistema Inmobiliario JCO'
                    : 'Valor de Operación / Lista'}
                </p>
                <p className="text-3xl font-semibold text-slate-900 font-mono-tabular">
                  {property.operation === 'Renta'
                    ? `${formatMoney(property.monthlyRentEstimationCOP)} / mes`
                    : formatMoney(property.priceCOP)}
                </p>
                <p className="text-xs text-stone-500 mt-1 font-mono-tabular">
                  {property.operation === 'Renta'
                    ? `Valor patrimonial de referencia: ${formatMoney(property.priceCOP)}`
                    : `Renta potencial estimada: ${formatMoney(property.monthlyRentEstimationCOP)} / mes · ${formatMoney(pricePerM2)} / m²`}
                </p>
              </div>

              <div className="space-y-2 text-xs text-slate-700 pb-4 border-b border-stone-200">
                <p className="font-semibold text-slate-900">Estatus Jurídico y Técnico</p>
                <p className="text-slate-600">{property.legalStatus}</p>
                <p className="text-stone-500 font-mono-tabular">
                  Cuota de cuota de administración: {formatMoney(property.maintenanceFeeCOP)} / mes · CAP Rate estimado: {property.rentalYieldPct}%
                </p>
              </div>

              {/* Direct Appointment Form */}
              {submitted ? (
                <div className="p-5 bg-white border border-[#14532D]/30 rounded-lg space-y-3">
                  <div className="flex items-center gap-2 text-[#14532D] font-semibold text-sm">
                    <Check className="w-4 h-4" />
                    <span>Recorrido Agendado · Folio #{property.code}</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Hemos registrado tu solicitud a nombre de <strong>{visitorName}</strong> para el día{' '}
                    <span className="font-mono-tabular font-medium">{visitDate}</span> bajo modalidad{' '}
                    <strong>{visitModality}</strong>. Un consultor patrimonial de Sistema Inmobiliario JCO te confirmará al{' '}
                    <span className="font-mono-tabular">{visitorPhone}</span>.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSubmitted(false)}
                    className="text-xs font-medium text-[#0F2942] underline"
                  >
                    Modificar horario o datos de contacto
                  </button>
                </div>
              ) : (
                <form onSubmit={handleBookingSubmit} className="space-y-3.5">
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#0F2942]" />
                    <span>Agendar Recorrido Privado o Dictamen</span>
                  </h3>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Modalidad de atención
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          'Recorrido en Propiedad',
                          'Cita en oficina principal',
                          'Videollamada Ejecutiva'
                        ] as const
                      ).map((mod) => (
                        <button
                          key={mod}
                          type="button"
                          onClick={() => setVisitModality(mod)}
                          className={`py-1.5 px-2 text-[11px] font-medium rounded border transition-colors truncate ${
                            visitModality === mod
                              ? 'bg-[#0F2942] text-white border-[#0F2942]'
                              : 'bg-white text-slate-700 border-stone-200 hover:border-stone-300'
                          }`}
                        >
                          {mod}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="visit-name" className="block text-xs font-medium text-slate-700 mb-1">
                      Nombre completo
                    </label>
                    <input
                      id="visit-name"
                      type="text"
                      required
                      placeholder="Ej. Lic. Alejandro Gómez"
                      value={visitorName}
                      onChange={(e) => setVisitorName(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-[#0F2942]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="visit-phone" className="block text-xs font-medium text-slate-700 mb-1">
                        Teléfono / WhatsApp (10 dígitos)
                      </label>
                      <input
                        id="visit-phone"
                        type="tel"
                        required
                        placeholder="33 2310 1060"
                        value={visitorPhone}
                        onChange={(e) => setVisitorPhone(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs text-slate-900 font-mono-tabular focus:outline-none focus:border-[#0F2942]"
                      />
                    </div>
                    <div>
                      <label htmlFor="visit-date" className="block text-xs font-medium text-slate-700 mb-1">
                        Fecha preferente
                      </label>
                      <input
                        id="visit-date"
                        type="date"
                        required
                        value={visitDate}
                        onChange={(e) => setVisitDate(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs text-slate-900 font-mono-tabular focus:outline-none focus:border-[#0F2942]"
                      />
                    </div>
                  </div>

                  {formError && (
                    <p className="text-xs text-red-700 font-medium">{formError}</p>
                  )}

                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 bg-[#0F2942] hover:bg-[#163859] text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                  >
                    Confirmar Solicitud de Recorrido
                  </button>
                </form>
              )}
            </div>

            <div className="pt-4 border-t border-stone-200 flex items-center justify-between text-xs text-stone-600">
              <span>Atención directa:</span>
              <a
                href="tel:+523323101060"
                className="font-mono-tabular font-semibold text-slate-900 hover:text-[#0F2942] flex items-center gap-1.5"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>(33) 2310 1060</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
