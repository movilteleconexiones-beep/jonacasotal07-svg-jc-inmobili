/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  PROPERTIES,
  CASE_STUDIES,
  ACADEMY_MODULES,
  HERO_IMAGE,
  Property,
  AcademyModule
} from './data/properties.ts';
import { ResilientImage } from './components/ResilientImage.tsx';
import { PatrimonialSimulator } from './components/PatrimonialSimulator.tsx';
import { PropertyDetailModal } from './components/PropertyDetailModal.tsx';
import { SubmitPropertyModal } from './components/SubmitPropertyModal.tsx';
import { AuthAccessButton } from './components/AuthAccessButton.tsx';
import { useAuth } from './core/auth-context.tsx';
import { PrivateDashboard } from './modules/dashboard/PrivateDashboard.tsx';
import { useTenantBranding } from './core/use-tenant-branding';
import {
  Search,
  ArrowRight,
  Bookmark,
  Scale,
  Check,
  MapPin,
  Phone,
  Mail,
  SlidersHorizontal,
  X
} from 'lucide-react';

export default function App() {
  const { user, activeMembership } = useAuth();
  const { branding } = useTenantBranding();
  const [isPrivateDashboardOpen, setIsPrivateDashboardOpen] = useState(false);
  // Catalog state
  const [properties, setProperties] = useState<Property[]>(PROPERTIES);
  const [operationFilter, setOperationFilter] = useState<'Todas' | Property['operation']>('Todas');
  const [categoryFilter, setCategoryFilter] = useState<'Todas' | Property['category']>('Todas');
  const [zoneFilter, setZoneFilter] = useState<'Todas' | Property['neighborhood']>('Todas');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'featured' | 'price-desc' | 'price-asc' | 'yield-desc'>('featured');

  // Interactive modals & portfolio state
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [savedPropertyIds, setSavedPropertyIds] = useState<string[]>(['prop-1', 'prop-2']);
  const [comparePropertyIds, setComparePropertyIds] = useState<string[]>([]);
  const [isPortfolioDrawerOpen, setIsPortfolioDrawerOpen] = useState(false);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [scheduledVisitsLog, setScheduledVisitsLog] = useState<
    Array<{ code: string; title: string; name: string; date: string; modality: string }>
  >([]);

  // JC Inmobilearning state
  const [selectedAcademyModule, setSelectedAcademyModule] = useState<AcademyModule>(ACADEMY_MODULES[0]);
  const [enrolledModules, setEnrolledModules] = useState<string[]>([]);
  const [academyStudentName, setAcademyStudentName] = useState('');
  const [academyStudentEmail, setAcademyStudentEmail] = useState('');
  const [academyNotice, setAcademyNotice] = useState('');

  // Contact / Lead Form state
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactService, setContactService] = useState('Administración Integral de Propiedad');
  const [contactNotes, setContactNotes] = useState('');
  const [contactSubmitted, setContactSubmitted] = useState(false);
  const [contactError, setContactError] = useState('');

  const formatMoney = (val: number) =>
    new Intl.NumberFormat(branding.locale || 'es-CO', {
      style: 'currency',
      currency: branding.currency || 'COP',
      maximumFractionDigits: 0
    }).format(val);

  const filteredProperties = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = properties.filter((item) => {
      const matchesOp = operationFilter === 'Todas' || item.operation === operationFilter;
      const matchesCat = categoryFilter === 'Todas' || item.category === categoryFilter;
      const matchesZone = zoneFilter === 'Todas' || item.neighborhood === zoneFilter;
      const matchesQuery =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.neighborhood.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q) ||
        item.architecturalSummary.toLowerCase().includes(q);
      return matchesOp && matchesCat && matchesZone && matchesQuery;
    });

    if (sortBy === 'price-desc') {
      return [...list].sort((a, b) => b.priceMXN - a.priceMXN);
    }
    if (sortBy === 'price-asc') {
      return [...list].sort((a, b) => a.priceMXN - b.priceMXN);
    }
    if (sortBy === 'yield-desc') {
      return [...list].sort((a, b) => b.rentalYieldPct - a.rentalYieldPct);
    }
    return list;
  }, [properties, operationFilter, categoryFilter, zoneFilter, searchQuery, sortBy]);

  const savedProperties = useMemo(
    () => properties.filter((p) => savedPropertyIds.includes(p.id)),
    [properties, savedPropertyIds]
  );

  const comparedProperties = useMemo(
    () => properties.filter((p) => comparePropertyIds.includes(p.id)),
    [properties, comparePropertyIds]
  );

  const toggleSaveProperty = (id: string) => {
    setSavedPropertyIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleCompareProperty = (id: string) => {
    setComparePropertyIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= 3) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const handleRequestDiagnosticFromSimulator = (summaryText: string) => {
    setContactService('Diagnóstico Financiero y Patrimonial');
    setContactNotes(summaryText);
    const contactEl = document.getElementById('contacto');
    if (contactEl) {
      contactEl.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleAcademyEnroll = (e: React.FormEvent) => {
    e.preventDefault();
    if (academyStudentName.trim().length < 3 || !academyStudentEmail.includes('@')) {
      setAcademyNotice('Ingresa tu nombre completo y un correo electrónico válido.');
      return;
    }
    if (!enrolledModules.includes(selectedAcademyModule.id)) {
      setEnrolledModules((prev) => [...prev, selectedAcademyModule.id]);
    }
    setAcademyNotice(
      `Lugar reservado para ${academyStudentName.trim()} en ${selectedAcademyModule.number} (${selectedAcademyModule.nextCohortDate}). Enviamos ficha de inscripción a ${academyStudentEmail.trim()}.`
    );
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (contactName.trim().length < 3) {
      setContactError('Por favor ingresa tu nombre completo.');
      return;
    }
    if (!contactEmail.includes('@') || !contactEmail.includes('.')) {
      setContactError('Por favor ingresa un correo electrónico válido.');
      return;
    }
    if (contactPhone.replace(/\D/g, '').length < 10) {
      setContactError('Ingresa un número telefónico de 10 dígitos.');
      return;
    }
    setContactError('');
    setContactSubmitted(true);
  };

  if (isPrivateDashboardOpen && user && activeMembership) {
    return <PrivateDashboard onClose={() => setIsPrivateDashboardOpen(false)} />;
  }

  return (
    <div id="inicio" className="min-h-screen flex flex-col bg-[#F6F6F4] text-slate-900">
      {/* 2. TOP BAR CONTRACT: Strictly 1 row, 3 zones (Brand Wordmark — 5 Nav Links — Primary Actions) */}
      <header className="sticky top-0 z-40 bg-[#F6F6F4]/95 backdrop-blur-md border-b border-stone-200/90">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#inicio"
            className="text-2xl font-display font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            {branding.companyName}
          </a>

          {/* Zone 2: 5 clean text navigation links */}
          <nav
            aria-label="Navegación principal"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-700"
          >
            <a
              href="#catalogo"
              className="hover:text-slate-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              Catálogo
            </a>
            <a
              href="#servicios"
              className="hover:text-slate-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              Servicios
            </a>
            <a
              href="#calculadora"
              className="hover:text-slate-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              Calculadora
            </a>
            <a
              href="#inmobilearning"
              className="hover:text-slate-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              JC Inmobilearning
            </a>
            <a
              href="#contacto"
              className="hover:text-slate-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              Contacto
            </a>
          </nav>

          {/* Zone 3: 2 primary actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsPortfolioDrawerOpen(true)}
              className="px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-stone-300 rounded-lg hover:border-slate-900 transition-colors whitespace-nowrap font-mono-tabular"
            >
              Portafolio ({savedPropertyIds.length})
            </button>
            <button
              type="button"
              onClick={() => setIsSubmitModalOpen(true)}
              className="px-4 py-2 text-xs font-medium text-white bg-[#0F2942] hover:bg-[#163859] rounded-lg transition-colors whitespace-nowrap"
            >
              Consignar Propiedad
            </button>
            {user && activeMembership && (
              <button
                type="button"
                onClick={() => setIsPrivateDashboardOpen(true)}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
              >
                Panel
              </button>
            )}
            <AuthAccessButton />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* HERO SECTION: Single dominant 16:9 architectural focal carrier */}
        <section className="relative bg-slate-950 text-white overflow-hidden">
          <div className="absolute inset-0">
            <ResilientImage
              src={HERO_IMAGE}
              alt="Residencia de arquitectura contemporánea en Colombia"
              className="w-full h-full object-cover opacity-65"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/65 to-slate-950/30" />
          </div>

          <div className="relative max-w-[1200px] mx-auto px-6 pt-20 pb-16 md:pt-28 md:pb-24">
            <div className="max-w-3xl space-y-6">
              {/* Unboxed regional & heritage metadata with typographic separators */}
              <p className="text-xs md:text-sm font-medium text-stone-300 tracking-wide">
                Colombia · Gestión inmobiliaria especializada · Plataforma profesional
              </p>

              <h1 className="text-4xl sm:text-5xl md:text-6xl font-display font-semibold tracking-tight leading-[1.08] text-white balance-text">
                Comercialización, Administración Integral y Blindaje Inmobiliario.
              </h1>

              <p className="text-base md:text-lg text-stone-200 max-w-2xl leading-relaxed font-normal">
                Gestionamos tu patrimonio inmobiliario en Colombia mediante procesos comerciales, administrativos y documentales centralizados en una sola plataforma.
              </p>

              {/* Quantitative proof bar in clean unboxed layout */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-4 pb-2 border-y border-white/15">
                <div>
                  <p className="text-2xl md:text-3xl font-semibold text-white font-mono-tabular">18+</p>
                  <p className="text-xs text-stone-300 mt-0.5">Trayectoria inmobiliaria</p>
                </div>
                <div>
                  <p className="text-2xl md:text-3xl font-semibold text-white font-mono-tabular">99.4%</p>
                  <p className="text-xs text-stone-300 mt-0.5">Cobranza puntual en rentas</p>
                </div>
                <div>
                  <p className="text-2xl md:text-3xl font-semibold text-white font-mono-tabular">34 días</p>
                  <p className="text-xs text-stone-300 mt-0.5">Promedio de colocación</p>
                </div>
                <div>
                  <p className="text-2xl md:text-3xl font-semibold text-white font-mono-tabular">100%</p>
                  <p className="text-xs text-stone-300 mt-0.5">Dictamen libre de gravamen</p>
                </div>
              </div>
            </div>

            {/* Direct Interactive Search & Filter Console anchored at base of Hero */}
            <div className="mt-10 bg-white text-slate-900 p-4 md:p-5 rounded-xl border border-stone-200 shadow-xl">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                {/* Search input */}
                <div className="md:col-span-4 relative">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por colonia, clave (JC-1084) o acabado..."
                    aria-label="Buscar propiedades"
                    className="w-full pl-10 pr-3 py-2.5 bg-[#F6F6F4] border border-stone-200 rounded-lg text-xs text-slate-900 placeholder:text-stone-500 focus:outline-none focus:border-[#0F2942]"
                  />
                </div>

                {/* Operation Segmented Buttons */}
                <div className="md:col-span-4 flex items-center bg-[#F6F6F4] p-1 rounded-lg border border-stone-200">
                  {(['Todas', 'Venta', 'Renta', 'Administración'] as const).map((op) => (
                    <button
                      key={op}
                      type="button"
                      onClick={() => setOperationFilter(op)}
                      className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap truncate ${
                        operationFilter === op
                          ? 'bg-[#0F2942] text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {op}
                    </button>
                  ))}
                </div>

                {/* Zone Selector */}
                <div className="md:col-span-2">
                  <select
                    value={zoneFilter}
                    onChange={(e) => setZoneFilter(e.target.value as 'Todas' | Property['neighborhood'])}
                    aria-label="Filtrar por zona en Colombia"
                    className="w-full px-3 py-2.5 bg-[#F6F6F4] border border-stone-200 rounded-lg text-xs font-medium text-slate-800 focus:outline-none focus:border-[#0F2942]"
                  >
                    <option value="Todas">Todas las zonas</option>
                    <option value="El Poblado">El Poblado</option>
                    <option value="Chicó">Chicó</option>
                    <option value="Envigado">Envigado</option>
                    <option value="Laureles">Laureles</option>
                    <option value="Usaquén">Usaquén</option>
                    <option value="Ciudad del Río">Ciudad del Río</option>
                  </select>
                </div>

                {/* Jump to Catalog CTA */}
                <div className="md:col-span-2">
                  <a
                    href="#catalogo"
                    className="w-full py-2.5 px-4 bg-[#0F2942] hover:bg-[#163859] text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <span>Ver ({filteredProperties.length})</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 1: FEATURED PROPERTY CATALOG & COMPARISON MATRIX */}
        <section id="catalogo" className="py-20 max-w-[1200px] mx-auto px-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
            <div>
              <p className="text-xs font-medium text-stone-500 tracking-wide mb-2">
                Inventario inmobiliario · Colombia
              </p>
              <h2 className="text-3xl md:text-4xl font-semibold text-slate-900 tracking-tight balance-text">
                Propiedades en Venta, Renta y Administración
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Category filter buttons */}
              <div className="inline-flex items-center p-1 bg-stone-200/70 rounded-lg">
                {(['Todas', 'Residencial', 'Departamento', 'Comercial y Terreno'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      categoryFilter === cat
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {cat === 'Comercial y Terreno' ? 'Comercial' : cat}
                  </button>
                ))}
              </div>

              {/* Sort dropdown */}
              <div className="flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-3 py-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-stone-500" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  aria-label="Ordenar propiedades"
                  className="text-xs font-medium text-slate-700 bg-transparent focus:outline-none"
                >
                  <option value="featured">Orden: Destacadas JC</option>
                  <option value="price-desc">Precio: Mayor a Menor</option>
                  <option value="price-asc">Precio: Menor a Mayor</option>
                  <option value="yield-desc">Mayor Rentabilidad (CAP Rate)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Side-by-Side Comparison Bar & Table when properties are selected for comparison */}
          {comparedProperties.length > 0 && (
            <div className="mb-10 bg-white border border-stone-300 rounded-xl p-6">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-stone-200">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Matriz Comparativa de Inversión ({comparedProperties.length}/3 seleccionadas)
                  </h3>
                  <p className="text-xs text-stone-500">
                    Comparación técnica de superficie, precio por metro cuadrado y rendimiento anual estimado.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setComparePropertyIds([])}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 underline"
                >
                  Limpiar comparador
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500">
                      <th className="py-2.5 pr-4 font-medium">Propiedad / Clave</th>
                      <th className="py-2.5 px-4 font-medium">Zona</th>
                      <th className="py-2.5 px-4 font-medium">Operación</th>
                      <th className="py-2.5 px-4 font-medium">Valor Lista</th>
                      <th className="py-2.5 px-4 font-medium">Renta Est. / Mes</th>
                      <th className="py-2.5 px-4 font-medium">Superficie (T / C)</th>
                      <th className="py-2.5 px-4 font-medium">Precio / m²</th>
                      <th className="py-2.5 pl-4 font-medium">Plusvalía / CAP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200/80">
                    {comparedProperties.map((cp) => (
                      <tr key={cp.id} className="hover:bg-stone-50">
                        <td className="py-3 pr-4 font-medium text-slate-900">
                          <span className="font-mono-tabular text-[#0F2942] mr-1.5">{cp.code}</span>
                          {cp.title}
                        </td>
                        <td className="py-3 px-4 text-slate-600">{cp.neighborhood}</td>
                        <td className="py-3 px-4 text-slate-700">{cp.operation}</td>
                        <td className="py-3 px-4 font-mono-tabular font-semibold text-slate-900">
                          {formatMoney(cp.priceMXN)}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-700">
                          {formatMoney(cp.monthlyRentEstimationMXN)}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-700">
                          {cp.landAreaM2} m² / {cp.constructionAreaM2} m²
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-700">
                          {formatMoney(Math.round(cp.priceMXN / cp.constructionAreaM2))}
                        </td>
                        <td className="py-3 pl-4 font-mono-tabular font-semibold text-[#14532D]">
                          +{cp.annualAppreciationPct}% · CAP {cp.rentalYieldPct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3-Column Property Grid */}
          {filteredProperties.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-xl p-12 text-center space-y-4">
              <p className="text-base font-medium text-slate-900">
                No se encontraron propiedades con los filtros seleccionados.
              </p>
              <p className="text-xs text-stone-500 max-w-md mx-auto">
                Restablece los criterios de búsqueda o solicita a nuestro comité comercial una búsqueda personalizada en nuestro inventario privado en Colombia.
              </p>
              <button
                type="button"
                onClick={() => {
                  setOperationFilter('Todas');
                  setCategoryFilter('Todas');
                  setZoneFilter('Todas');
                  setSearchQuery('');
                }}
                className="px-4 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg"
              >
                Mostrar todas las propiedades ({properties.length})
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredProperties.map((property) => {
                const isSaved = savedPropertyIds.includes(property.id);
                const isCompared = comparePropertyIds.includes(property.id);

                return (
                  <article
                    key={property.id}
                    className="group bg-white border border-stone-200/90 rounded-xl overflow-hidden flex flex-col justify-between transition-transform duration-150 hover:-translate-y-0.5"
                  >
                    <div>
                      {/* 4:3 Property Imagery */}
                      <div
                        onClick={() => setSelectedProperty(property)}
                        className="relative aspect-4/3 w-full bg-stone-100 overflow-hidden cursor-pointer"
                      >
                        <ResilientImage
                          src={property.image}
                          alt={property.title}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/55 via-transparent to-transparent" />
                        <div className="absolute bottom-3 left-4 right-4 flex items-baseline justify-between text-white">
                          <span className="text-xs font-medium tracking-wide">
                            {property.operation} · {property.category}
                          </span>
                          <span className="text-xs font-mono-tabular text-stone-200">
                            {property.code}
                          </span>
                        </div>
                      </div>

                      {/* Card Body: Zero-Pill Unboxed Metadata */}
                      <div className="p-6 space-y-3">
                        <div className="flex items-center gap-1.5 text-xs text-stone-500">
                          <span>{property.neighborhood}</span>
                          <span aria-hidden="true">·</span>
                          <span>{property.municipality}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular text-[#14532D] font-medium">
                            +{property.annualAppreciationPct}% plusvalía
                          </span>
                        </div>

                        <h3 className="text-lg font-semibold text-slate-900 leading-snug">
                          <button
                            type="button"
                            onClick={() => setSelectedProperty(property)}
                            className="text-left hover:text-[#0F2942] transition-colors"
                          >
                            {property.title}
                          </button>
                        </h3>

                        {/* Price in Tabular Numerals */}
                        <div className="pt-1">
                          <p className="text-xl font-semibold text-slate-900 font-mono-tabular">
                            {property.operation === 'Renta'
                              ? `${formatMoney(property.monthlyRentEstimationMXN)} / mes`
                              : formatMoney(property.priceMXN)}
                          </p>
                          <p className="text-xs text-stone-500 font-mono-tabular mt-0.5">
                            {property.operation === 'Renta'
                              ? `Póliza JC incluida · Mant. ${formatMoney(property.maintenanceFeeMXN)}`
                              : `Renta estimada: ${formatMoney(property.monthlyRentEstimationMXN)}/mes · CAP ${property.rentalYieldPct}%`}
                          </p>
                        </div>

                        {/* Unboxed Technical Specs */}
                        <div className="pt-3 border-t border-stone-200/80 flex items-center justify-between text-xs text-slate-600 font-mono-tabular">
                          <span>{property.landAreaM2} m² T</span>
                          <span aria-hidden="true">·</span>
                          <span>{property.constructionAreaM2} m² C</span>
                          <span aria-hidden="true">·</span>
                          <span>{property.bedrooms} Rec</span>
                          <span aria-hidden="true">·</span>
                          <span>{property.bathrooms} Baños</span>
                        </div>
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div className="px-6 pb-6 pt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedProperty(property)}
                        className="flex-1 py-2.5 px-3 bg-[#0F2942] hover:bg-[#163859] text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                      >
                        Ver Expediente y Cita
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleCompareProperty(property.id)}
                        title="Comparar propiedad"
                        className={`p-2.5 rounded-lg border transition-colors ${
                          isCompared
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-stone-200 hover:border-slate-900'
                        }`}
                        aria-label="Comparar propiedad"
                      >
                        <Scale className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleSaveProperty(property.id)}
                        title="Guardar en portafolio"
                        className={`p-2.5 rounded-lg border transition-colors ${
                          isSaved
                            ? 'bg-[#14532D] text-white border-[#14532D]'
                            : 'bg-white text-slate-600 border-stone-200 hover:border-slate-900'
                        }`}
                        aria-label="Guardar en portafolio"
                      >
                        <Bookmark className="w-4 h-4" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* SECTION 2: CORE CAPABILITIES & ADJACENT PROOF OF IMPACT (CASE STUDIES) */}
        <section id="servicios" className="py-20 border-t border-stone-200/90 bg-[#F2F2EE]">
          <div className="max-w-[1200px] mx-auto px-6 space-y-20">
            {/* Part A: Asymmetric Numbered Service Architecture */}
            <div>
              <div className="max-w-2xl mb-12">
                <p className="text-xs font-medium text-stone-500 tracking-wide mb-2">
                  Arquitectura de Servicios · Soluciones Inmobiliarias Integrales
                </p>
                <h2 className="text-3xl md:text-4xl font-semibold text-slate-900 tracking-tight balance-text">
                  Gestión inmobiliaria de principio a fin en Colombia
                </h2>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Marquee Capability 01 (col-span-2) */}
                <div className="lg:col-span-2 bg-white border border-stone-200/90 rounded-xl p-8 flex flex-col justify-between">
                  <div className="space-y-4">
                    <p className="text-xs font-mono-tabular font-semibold text-[#0F2942]">
                      01. Administración Integral de Inmuebles y Arrendamiento Seguro
                    </p>
                    <h3 className="text-2xl font-semibold text-slate-900 balance-text">
                      Cobranza garantizada, investigación jurídica de inquilinos y cero desgaste operativo para el propietario.
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed max-w-2xl">
                      Nos hacemos cargo de la relación completa con el arrendatario: investigación en buró legal y crediticio, contratos blindados ante extinción de dominio ratificados mediante mecanismos de conciliación aplicables en Colombia, cobro puntual, pago de predial, cuotas de administración y supervisión física semestral.
                    </p>
                  </div>
                  <div className="pt-6 mt-6 border-t border-stone-200/80 flex flex-wrap items-center justify-between gap-4 text-xs text-stone-600">
                    <span>Cobertura: residencial, corporativa y comercial</span>
                    <a
                      href="#calculadora"
                      className="font-semibold text-[#0F2942] hover:underline flex items-center gap-1"
                    >
                      <span>Calcular rendimiento de mi renta</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                {/* Capability 02 (col-span-1) */}
                <div className="bg-white border border-stone-200/90 rounded-xl p-8 flex flex-col justify-between">
                  <div className="space-y-4">
                    <p className="text-xs font-mono-tabular font-semibold text-[#0F2942]">
                      02. Promoción y Compraventa Notarial
                    </p>
                    <h3 className="text-xl font-semibold text-slate-900">
                      Comercialización estratégica en Lamudi, Casas y Terrenos y Red Privada.
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Valuación comercial real por m², fotografía arquitectónica, filtrado de compradores con liquidez o crédito preaprobado y acompañamiento hasta firma de escritura y entrega física.
                    </p>
                  </div>
                  <div className="pt-6 mt-6 border-t border-stone-200/80 text-xs text-stone-500 font-mono-tabular">
                    Tiempo promedio de venta: 34 a 60 días
                  </div>
                </div>

                {/* Capability 03 (col-span-1) */}
                <div className="bg-white border border-stone-200/90 rounded-xl p-8 flex flex-col justify-between">
                  <div className="space-y-4">
                    <p className="text-xs font-mono-tabular font-semibold text-[#0F2942]">
                      03. Dictaminación Jurídica y Fiscal
                    </p>
                    <h3 className="text-xl font-semibold text-slate-900">
                      Certeza documental antes de comprometer tu patrimonio.
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Auditoría de libertad de gravamen, régimen en condominio, cálculo de exención o deducción de ISR por enajenación de bienes y coordinación directa con notarías y oficinas de registro según la operación.
                    </p>
                  </div>
                  <div className="pt-6 mt-6 border-t border-stone-200/80 text-xs text-stone-500 font-mono-tabular">
                    100% operaciones con expediente auditado
                  </div>
                </div>

                {/* Capability 04 (col-span-2) */}
                <div className="lg:col-span-2 bg-white border border-stone-200/90 rounded-xl p-8 flex flex-col justify-between">
                  <div className="space-y-4">
                    <p className="text-xs font-mono-tabular font-semibold text-[#14532D]">
                      04. Conservación Patrimonial, Mantenimiento y Domótica Residencial
                    </p>
                    <h3 className="text-2xl font-semibold text-slate-900 balance-text">
                      Cuadrillas propias para incrementar el valor de renta y venta de tu propiedad.
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed max-w-2xl">
                      A diferencia de una agencia tradicional, JC Inmobili cuenta con división técnica de impermeabilización garantizada, pintura arquitectónica, climatización (aire acondicionado Inverter), cortinas y persianas a medida, sistemas de alarma y automatización inteligente (domótica).
                    </p>
                  </div>
                  <div className="pt-6 mt-6 border-t border-stone-200/80 flex flex-wrap items-center justify-between gap-4 text-xs text-stone-600">
                    <span>Impermeabilización · Pintura · Aire Acondicionado · Persianas · Domótica</span>
                    <a
                      href="#contacto"
                      onClick={() => setContactService('Cotización de Mantenimiento, Persianas o Domótica')}
                      className="font-semibold text-[#14532D] hover:underline flex items-center gap-1"
                    >
                      <span>Solicitar levantamiento técnico</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Part B: Claim-to-Proof Adjacency — Quantified Case Studies & Attributable Testimonials */}
            <div>
              <div className="max-w-2xl mb-10">
                <p className="text-xs font-medium text-stone-500 tracking-wide mb-2">
                  Evidencia de gestión · Resultados inmobiliarios
                </p>
                <h2 className="text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight balance-text">
                  Casos de Éxito y Testimonios Patrimoniales
                </h2>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {CASE_STUDIES.map((cs) => (
                  <article
                    key={cs.id}
                    className="bg-white border border-stone-200/90 rounded-xl p-6 flex flex-col justify-between space-y-5"
                  >
                    <div className="space-y-3">
                      <div className="text-xs text-stone-500">
                        <span>{cs.neighborhood}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono-tabular">{cs.timeframe}</span>
                      </div>

                      <p className="text-xs font-medium text-[#0F2942]">{cs.serviceApplied}</p>

                      <h3 className="text-lg font-semibold text-slate-900 font-mono-tabular leading-snug">
                        {cs.metricHeadline}
                      </h3>

                      <div className="space-y-2 pt-2 text-xs text-slate-600 leading-relaxed">
                        <p>
                          <strong className="text-slate-900">Situación inicial:</strong> {cs.beforeState}
                        </p>
                        <p>
                          <strong className="text-slate-900">Intervención JC:</strong> {cs.intervention}
                        </p>
                        <p>
                          <strong className="text-[#14532D]">Resultado:</strong> {cs.outcome}
                        </p>
                      </div>
                    </div>

                    <footer className="pt-4 border-t border-stone-200/80">
                      <p className="text-xs font-semibold text-slate-900">{cs.clientName}</p>
                      <p className="text-xs text-stone-500">
                        {cs.clientRole} · {cs.organization}
                      </p>
                    </footer>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: INTERACTIVE PATRIMONIAL & RENTAL ADMINISTRATION SIMULATOR */}
        <PatrimonialSimulator onRequestDiagnostic={handleRequestDiagnosticFromSimulator} />

        {/* SECTION 4: JC INMOBILEARNING (EXCLUSIVE REAL ESTATE ACADEMY) */}
        <section id="inmobilearning" className="py-20 border-t border-stone-200/90 bg-[#0F2942] text-white">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-12">
              <div className="max-w-2xl">
                <p className="text-xs font-medium text-stone-300 tracking-wide mb-2">
                  División Académica Exclusiva · Capacitación inmobiliaria en Colombia
                </p>
                <h2 className="text-3xl md:text-4xl font-display font-semibold tracking-tight text-white balance-text">
                  JC Inmobilearning: Formación Jurídica, Comercial y Patrimonial
                </h2>
              </div>
              <p className="text-sm text-stone-300 max-w-md">
                Más de 18 años de experiencia práctica en el mercado inmobiliario colombiano condensados en módulos ejecutivos para asesores, propietarios e inversionistas.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left 5 Cols: Module Selector List */}
              <div className="lg:col-span-5 space-y-3">
                {ACADEMY_MODULES.map((mod) => {
                  const isSelected = selectedAcademyModule.id === mod.id;
                  const isEnrolled = enrolledModules.includes(mod.id);

                  return (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => {
                        setSelectedAcademyModule(mod);
                        setAcademyNotice('');
                      }}
                      className={`w-full text-left p-5 rounded-xl border transition-colors ${
                        isSelected
                          ? 'bg-white text-slate-900 border-white'
                          : 'bg-[#163859]/60 text-stone-200 border-white/15 hover:border-white/35'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1.5 font-mono-tabular">
                        <span className={isSelected ? 'text-[#0F2942] font-semibold' : 'text-stone-300'}>
                          {mod.number} · {mod.durationHours} horas · {mod.modality}
                        </span>
                        <span className="font-semibold">
                          {isEnrolled ? 'Inscrito' : formatMoney(mod.priceMXN)}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold leading-snug">{mod.title}</h3>
                      <p
                        className={`text-xs mt-1.5 ${
                          isSelected ? 'text-stone-600' : 'text-stone-300'
                        }`}
                      >
                        Próxima apertura: {mod.nextCohortDate}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Right 7 Cols: Active Syllabus & Direct Enrollment */}
              <div className="lg:col-span-7 bg-white text-slate-900 rounded-xl p-6 md:p-8 border border-stone-200 space-y-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-stone-200">
                  <div className="text-xs text-stone-500">
                    <span className="font-mono-tabular font-semibold text-[#0F2942]">
                      {selectedAcademyModule.number}
                    </span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span>{selectedAcademyModule.modality}</span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span className="font-mono-tabular">Inicio: {selectedAcademyModule.nextCohortDate}</span>
                  </div>
                  <span className="text-xl font-semibold text-slate-900 font-mono-tabular">
                    {formatMoney(selectedAcademyModule.priceMXN)} COP
                  </span>
                </div>

                <div>
                  <h3 className="text-2xl font-semibold text-slate-900 balance-text">
                    {selectedAcademyModule.title}
                  </h3>
                  <p className="text-xs text-stone-500 mt-1">
                    Dirigido a: {selectedAcademyModule.audience} · Imparte: {selectedAcademyModule.instructor}
                  </p>
                  <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                    {selectedAcademyModule.summary}
                  </p>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-slate-900 tracking-wide mb-3">
                    Temario Ejecutivo del Módulo
                  </h4>
                  <ul className="space-y-2 text-xs text-slate-700">
                    {selectedAcademyModule.topics.map((topic, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="font-mono-tabular font-semibold text-[#0F2942]">
                          0{i + 1}.
                        </span>
                        <span>{topic}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <form
                  onSubmit={handleAcademyEnroll}
                  className="pt-5 border-t border-stone-200 space-y-3"
                >
                  <p className="text-xs font-semibold text-slate-900">
                    Reservar lugar en próxima generación ({selectedAcademyModule.nextCohortDate})
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      required
                      placeholder="Nombre completo del participante"
                      value={academyStudentName}
                      onChange={(e) => setAcademyStudentName(e.target.value)}
                      className="px-3.5 py-2 bg-[#F6F6F4] border border-stone-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-[#0F2942]"
                    />
                    <input
                      type="email"
                      required
                      placeholder="Correo electrónico para temario y acceso"
                      value={academyStudentEmail}
                      onChange={(e) => setAcademyStudentEmail(e.target.value)}
                      className="px-3.5 py-2 bg-[#F6F6F4] border border-stone-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-[#0F2942]"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-stone-500">
                      Modalidad presencial y virtual en Colombia.
                    </span>
                    <button
                      type="submit"
                      className="px-5 py-2.5 bg-[#0F2942] hover:bg-[#163859] text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                    >
                      Inscribirme al {selectedAcademyModule.number}
                    </button>
                  </div>
                  {academyNotice && (
                    <p className="text-xs font-medium text-[#14532D] pt-1">{academyNotice}</p>
                  )}
                </form>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 5: INTERACTIVE LEAD CAPTURE & ZAPOPAN HEADQUARTERS CONTACT */}
        <section id="contacto" className="py-20 bg-white border-t border-stone-200/90">
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
              {/* Left 5 Cols: Real Zapopan Office Details */}
              <div className="lg:col-span-5 space-y-6">
                <div>
                  <p className="text-xs font-medium text-stone-500 tracking-wide mb-2">
                    Atención Patrimonial Personalizada
                  </p>
                  <h2 className="text-3xl md:text-4xl font-semibold text-slate-900 tracking-tight balance-text">
                    Oficina y atención en Colombia
                  </h2>
                  <p className="text-sm text-slate-600 mt-3 leading-relaxed">
                    Agenda una sesión privada con nuestra dirección comercial o jurídica para evaluar la venta, administración en renta o mantenimiento integral de tus propiedades.
                  </p>
                </div>

                <div className="space-y-4 pt-4 border-t border-stone-200 text-sm">
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-[#0F2942] mt-1 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-900">Dirección Corporativa</p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Datos de sede configurables por cada inmobiliaria
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Phone className="w-4 h-4 text-[#0F2942] mt-1 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-900">Teléfono Directo y Recepción</p>
                      <a
                        href="tel:+523323101060"
                        className="text-xs font-mono-tabular text-[#0F2942] hover:underline mt-0.5 inline-block"
                      >
                        (33) 2310 1060
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Mail className="w-4 h-4 text-[#0F2942] mt-1 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-900">Correo Electrónico Comercial</p>
                      <a
                        href="mailto:mkt.jcinmobili@gmail.com"
                        className="text-xs font-mono-tabular text-[#0F2942] hover:underline mt-0.5 inline-block"
                      >
                        mkt.jcinmobili@gmail.com
                      </a>
                    </div>
                  </div>
                </div>

                {/* Scheduled Visits Log if user booked any property tour during session */}
                {scheduledVisitsLog.length > 0 && (
                  <div className="p-4 bg-[#F6F6F4] border border-stone-200 rounded-xl space-y-2">
                    <p className="text-xs font-semibold text-slate-900">
                      Tus Citas Registradas en esta Sesión ({scheduledVisitsLog.length})
                    </p>
                    <ul className="space-y-1.5 text-xs text-slate-600">
                      {scheduledVisitsLog.map((v, i) => (
                        <li key={i} className="font-mono-tabular">
                          · {v.code}: {v.modality} ({v.date}) — {v.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Right 7 Cols: Validated Lead Form */}
              <div className="lg:col-span-7 bg-[#F9F9F7] border border-stone-200/90 rounded-xl p-6 md:p-8">
                {contactSubmitted ? (
                  <div className="py-8 text-center space-y-4">
                    <div className="w-10 h-10 rounded-full bg-[#14532D] text-white flex items-center justify-center mx-auto">
                      <Check className="w-5 h-5" />
                    </div>
                    <h3 className="text-2xl font-semibold text-slate-900">
                      Solicitud Recibida por el Comité Patrimonial
                    </h3>
                    <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                      Gracias, <strong>{contactName}</strong>. Hemos asignado tu requerimiento de{' '}
                      <strong>{contactService}</strong>. Te contactaremos al{' '}
                      <span className="font-mono-tabular">{contactPhone}</span> y al correo{' '}
                      <span className="font-mono-tabular">{contactEmail}</span> en menos de 2 horas hábiles.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setContactSubmitted(false);
                        setContactNotes('');
                      }}
                      className="px-4 py-2 bg-[#0F2942] text-white text-xs font-medium rounded-lg"
                    >
                      Enviar otra consulta
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleContactSubmit} className="space-y-4">
                    <h3 className="text-lg font-semibold text-slate-900">
                      Solicitar Asesoría, Administración o Avalúo Comercial
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="c-name" className="block text-xs font-medium text-slate-700 mb-1">
                          Nombre completo
                        </label>
                        <input
                          id="c-name"
                          type="text"
                          required
                          placeholder="Ej. Lic. Roberto Hernández"
                          value={contactName}
                          onChange={(e) => setContactName(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white border border-stone-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-[#0F2942]"
                        />
                      </div>

                      <div>
                        <label htmlFor="c-phone" className="block text-xs font-medium text-slate-700 mb-1">
                          Teléfono / WhatsApp (10 dígitos)
                        </label>
                        <input
                          id="c-phone"
                          type="tel"
                          required
                          placeholder="33 2310 1060"
                          value={contactPhone}
                          onChange={(e) => setContactPhone(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white border border-stone-300 rounded-lg text-xs text-slate-900 font-mono-tabular focus:outline-none focus:border-[#0F2942]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="c-email" className="block text-xs font-medium text-slate-700 mb-1">
                          Correo electrónico
                        </label>
                        <input
                          id="c-email"
                          type="email"
                          required
                          placeholder="nombre@empresa.com"
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white border border-stone-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-[#0F2942]"
                        />
                      </div>

                      <div>
                        <label htmlFor="c-service" className="block text-xs font-medium text-slate-700 mb-1">
                          Servicio de interés
                        </label>
                        <select
                          id="c-service"
                          value={contactService}
                          onChange={(e) => setContactService(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-white border border-stone-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-[#0F2942]"
                        >
                          <option value="Administración Integral de Propiedad">
                            Administración Integral de Propiedad
                          </option>
                          <option value="Promoción para Venta de Inmueble">
                            Promoción para Venta de Inmueble
                          </option>
                          <option value="Búsqueda de Propiedad en Compra o Renta">
                            Búsqueda de Propiedad en Compra o Renta
                          </option>
                          <option value="Diagnóstico Financiero y Patrimonial">
                            Diagnóstico Financiero y Patrimonial
                          </option>
                          <option value="Cotización de Mantenimiento, Persianas o Domótica">
                            Cotización de Mantenimiento, Persianas o Domótica
                          </option>
                          <option value="Inscripción en Academia JC Inmobilearning">
                            Inscripción en Academia JC Inmobilearning
                          </option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="c-notes" className="block text-xs font-medium text-slate-700 mb-1">
                        Detalles de tu propiedad o requerimiento patrimonial
                      </label>
                      <textarea
                        id="c-notes"
                        rows={3}
                        placeholder="Indica ciudad, barrio, tipo de inmueble o dudas específicas..."
                        value={contactNotes}
                        onChange={(e) => setContactNotes(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-white border border-stone-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-[#0F2942]"
                      />
                    </div>

                    {contactError && (
                      <p className="text-xs text-red-700 font-medium">{contactError}</p>
                    )}

                    <button
                      type="submit"
                      className="w-full py-3 px-5 bg-[#0F2942] hover:bg-[#163859] text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                    >
                      Agendar Consulta con JC Inmobili
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* QUIET EDITORIAL FOOTER */}
      <footer className="bg-[#F6F6F4] border-t border-stone-200/90 py-12 text-xs text-stone-600">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="space-y-1">
            <p className="text-lg font-display font-bold text-slate-900">{branding.companyName}</p>
            <p>
              Datos de contacto configurables por cada inmobiliaria
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <a href="#catalogo" className="hover:text-slate-900">
              Catálogo
            </a>
            <a href="#servicios" className="hover:text-slate-900">
              Administración
            </a>
            <a href="#calculadora" className="hover:text-slate-900">
              Simulador
            </a>
            <a href="#inmobilearning" className="hover:text-slate-900">
              JC Inmobilearning
            </a>
            <span>© {new Date().getFullYear()} {branding.companyName}. Todos los derechos reservados.</span>
          </div>
        </div>
      </footer>

      {/* SAVED PORTFOLIO SLIDE-OVER DRAWER */}
      {isPortfolioDrawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Portafolio de propiedades guardadas"
        >
          <div className="bg-white w-full max-w-md h-full shadow-2xl border-l border-stone-200 flex flex-col justify-between p-6 overflow-y-auto">
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-stone-200">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    Portafolio Guardado ({savedProperties.length})
                  </h2>
                  <p className="text-xs text-stone-500">
                    Propiedades seleccionadas para análisis o recorrido
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPortfolioDrawerOpen(false)}
                  className="p-2 text-slate-500 hover:text-slate-900 rounded-lg"
                  aria-label="Cerrar portafolio"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {savedProperties.length === 0 ? (
                <p className="text-xs text-stone-500 py-8 text-center">
                  No tienes propiedades guardadas en tu portafolio. Haz clic en el icono de marcador en cualquier ficha del catálogo.
                </p>
              ) : (
                <div className="space-y-4">
                  {savedProperties.map((sp) => (
                    <div
                      key={sp.id}
                      className="p-4 border border-stone-200 rounded-lg bg-[#F9F9F7] space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs text-stone-500">
                        <span className="font-mono-tabular font-semibold text-[#0F2942]">
                          {sp.code} · {sp.neighborhood}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleSaveProperty(sp.id)}
                          className="text-stone-400 hover:text-red-700"
                        >
                          Quitar
                        </button>
                      </div>
                      <p className="text-sm font-semibold text-slate-900">{sp.title}</p>
                      <p className="text-sm font-mono-tabular font-semibold text-slate-800">
                        {sp.operation === 'Renta'
                          ? `${formatMoney(sp.monthlyRentEstimationMXN)} / mes`
                          : formatMoney(sp.priceMXN)}
                      </p>
                      <div className="pt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsPortfolioDrawerOpen(false);
                            setSelectedProperty(sp);
                          }}
                          className="w-full py-1.5 px-3 bg-[#0F2942] text-white text-xs font-medium rounded"
                        >
                          Abrir Expediente y Agendar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-stone-200">
              <button
                type="button"
                onClick={() => {
                  setIsPortfolioDrawerOpen(false);
                  const codes = savedProperties.map((s) => `${s.code} (${s.neighborhood})`).join(', ');
                  handleRequestDiagnosticFromSimulator(
                    `Solicitud de dossier comparativo y recorridos para portafolio guardado: ${codes || 'Consulta general'}.`
                  );
                }}
                className="w-full py-2.5 px-4 bg-[#0F2942] text-white text-xs font-medium rounded-lg"
              >
                Solicitar Recorrido de mi Portafolio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PROPERTY DETAIL MODAL */}
      <PropertyDetailModal
        property={selectedProperty}
        onClose={() => setSelectedProperty(null)}
        isSaved={selectedProperty ? savedPropertyIds.includes(selectedProperty.id) : false}
        onToggleSave={toggleSaveProperty}
        onScheduleVisit={(prop, visitData) => {
          setScheduledVisitsLog((prev) => [
            ...prev,
            {
              code: prop.code,
              title: prop.title,
              name: visitData.name,
              date: visitData.date,
              modality: visitData.modality
            }
          ]);
        }}
      />

      {/* CONSIGNAR / SUBMIT NEW PROPERTY MODAL */}
      <SubmitPropertyModal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        onAddProperty={(newProp) => {
          setProperties((prev) => [newProp, ...prev]);
          setSavedPropertyIds((prev) => [newProp.id, ...prev]);
        }}
      />
    </div>
  );
}
