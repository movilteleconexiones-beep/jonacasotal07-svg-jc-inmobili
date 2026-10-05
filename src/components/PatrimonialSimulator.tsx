// AI Studio resync: source preserved.
import React, { useState, useMemo } from 'react';
import { ZONE_VALUATION_BENCHMARKS, Property } from '../data/properties';
import { ArrowRight, Calculator, ShieldCheck, TrendingUp } from 'lucide-react';
import { useTenantBranding } from '../core/use-tenant-branding';

interface PatrimonialSimulatorProps {
  onRequestDiagnostic: (summaryText: string) => void;
}

type SimulatorTab = 'administracion' | 'hipoteca' | 'valuacion';

export const PatrimonialSimulator: React.FC<PatrimonialSimulatorProps> = ({
  onRequestDiagnostic
}) => {
  const { branding } = useTenantBranding();
  const [activeTab, setActiveTab] = useState<SimulatorTab>('administracion');

  // Tab 1: Administración de Renta state
  const [monthlyRent, setMonthlyRent] = useState<number>(4800000);
  const [adminPlan, setAdminPlan] = useState<'esencial' | 'integral' | 'garantizada'>('integral');
  const [includePreventivePack, setIncludePreventivePack] = useState<boolean>(true);

  // Tab 2: Hipoteca y Plusvalía state
  const [propertyValue, setPropertyValue] = useState<number>(1250000000);
  const [downPaymentPct, setDownPaymentPct] = useState<number>(30);
  const [termYears, setTermYears] = useState<10 | 15 | 20>(15);
  const [selectedZone, setSelectedZone] = useState<Property['neighborhood']>('El Poblado');

  // Tab 3: Valuación Rápida por m² state
  const [valZone, setValZone] = useState<Property['neighborhood']>('Envigado');
  const [landM2, setLandM2] = useState<number>(380);
  const [constM2, setConstM2] = useState<number>(420);
  const [conservationState, setConservationState] = useState<'nuevo' | 'excelente' | 'remodelar'>('excelente');

  const formatMoney = (amount: number) =>
    new Intl.NumberFormat(branding.locale || 'es-CO', {
      style: 'currency',
      currency: branding.currency || 'COP',
      maximumFractionDigits: 0
    }).format(amount);

  const adminResults = useMemo(() => {
    const feeRate = adminPlan === 'esencial' ? 0.08 : adminPlan === 'integral' ? 0.1 : 0.12;
    const monthlyFee = monthlyRent * feeRate;
    const preventiveReserve = includePreventivePack ? monthlyRent * 0.035 : 0;
    const netMonthlyOwner = monthlyRent - monthlyFee - preventiveReserve;
    const netAnnualOwner = netMonthlyOwner * 12;
    const unshieldedRiskCost = monthlyRent * 2.4; // average vacancy + legal friction without formal administration
    return {
      feeRatePct: Math.round(feeRate * 100),
      monthlyFee,
      preventiveReserve,
      netMonthlyOwner,
      netAnnualOwner,
      unshieldedRiskCost
    };
  }, [monthlyRent, adminPlan, includePreventivePack]);

  const mortgageResults = useMemo(() => {
    const downPayment = propertyValue * (downPaymentPct / 100);
    const loanAmount = propertyValue - downPayment;
    const annualRate = 0.12; // Tasa ilustrativa editable para simulación financiera
    const monthlyRate = annualRate / 12;
    const totalMonths = termYears * 12;
    const monthlyPayment =
      loanAmount > 0
        ? (loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalMonths))) /
          (Math.pow(1 + monthlyRate, totalMonths) - 1)
        : 0;
    const closingCostsColombia = propertyValue * 0.048; // Estimación ilustrativa de gastos notariales, registrales y avalúo
    const zoneAppreciation = ZONE_VALUATION_BENCHMARKS[selectedZone].annualAppreciationPct / 100;
    const valueIn5Years = propertyValue * Math.pow(1 + zoneAppreciation, 5);
    const capitalGain5Years = valueIn5Years - propertyValue;

    return {
      downPayment,
      loanAmount,
      monthlyPayment,
      closingCostsColombia,
      zoneAppreciationPct: ZONE_VALUATION_BENCHMARKS[selectedZone].annualAppreciationPct,
      valueIn5Years,
      capitalGain5Years
    };
  }, [propertyValue, downPaymentPct, termYears, selectedZone]);

  const valuationResults = useMemo(() => {
    const benchmark = ZONE_VALUATION_BENCHMARKS[valZone];
    const conditionMultiplier =
      conservationState === 'nuevo' ? 1.08 : conservationState === 'excelente' ? 1.0 : 0.88;
    const baseConstructionValue = constM2 * benchmark.avgPricePerM2MXN * conditionMultiplier;
    const landExcessBonus = Math.max(0, landM2 - constM2 * 0.65) * (benchmark.avgPricePerM2MXN * 0.42);
    const estimatedCommercialValue = baseConstructionValue + landExcessBonus;
    const lowRange = estimatedCommercialValue * 0.95;
    const highRange = estimatedCommercialValue * 1.05;
    const estimatedMonthlyRent = (estimatedCommercialValue * (benchmark.avgYieldPct / 100)) / 12;

    return {
      benchmark,
      estimatedCommercialValue,
      lowRange,
      highRange,
      estimatedMonthlyRent
    };
  }, [valZone, landM2, constM2, conservationState]);

  return (
    <section id="calculadora" className="py-20 border-t border-stone-200/90 bg-white">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-12">
          <div>
            <p className="text-xs font-medium text-stone-500 tracking-wide mb-2">
              Herramienta financiera y patrimonial · {branding.country}
            </p>
            <h2 className="text-3xl md:text-4xl font-semibold text-slate-900 tracking-tight balance-text">
              Simulador de Administración, Crédito y Valor Comercial
            </h2>
          </div>

          {/* Interactive Segmented Control (Functional Buttons) */}
          <div
            className="inline-flex items-center p-1 bg-[#F2F2EE] rounded-lg border border-stone-200/80 self-start"
            role="tablist"
            aria-label="Modos de simulación patrimonial"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'administracion'}
              onClick={() => setActiveTab('administracion')}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'administracion'
                  ? 'bg-[#0F2942] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Administración de Renta
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'hipoteca'}
              onClick={() => setActiveTab('hipoteca')}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'hipoteca'
                  ? 'bg-[#0F2942] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Hipoteca y Plusvalía 5 Años
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'valuacion'}
              onClick={() => setActiveTab('valuacion')}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'valuacion'
                  ? 'bg-[#0F2942] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Estimador de Valor por Zona
            </button>
          </div>
        </div>

        {/* Single-Elevation Container with Hairline Divider Grid */}
        <div className="border border-stone-200/90 rounded-xl bg-[#F9F9F7] overflow-hidden">
          {activeTab === 'administracion' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-stone-200/90">
              {/* Left Column: Controls */}
              <div className="lg:col-span-7 p-6 md:p-8 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">
                    Cálculo de Flujo Neto para Propietarios en Arrendamiento
                  </h3>
                  <p className="text-sm text-slate-600">
                    Estima tu ingreso anual bajo la gestión administrativa de {operatorName}. Los servicios jurídicos, técnicos o aseguradores dependen de la inmobiliaria y/o de sus proveedores contratados.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="rent-slider" className="text-sm font-medium text-slate-800">
                      Renta mensual estimada del inmueble
                    </label>
                    <span className="text-base font-semibold text-[#0F2942] font-mono-tabular">
                      {formatMoney(monthlyRent)} / mes
                    </span>
                  </div>
                  <input
                    id="rent-slider"
                    type="range"
                    min={12000}
                    max={220000}
                    step={2000}
                    value={monthlyRent}
                    onChange={(e) => setMonthlyRent(Number(e.target.value))}
                    className="w-full accent-[#0F2942] cursor-pointer h-2 bg-stone-200 rounded-lg"
                  />
                  <div className="flex justify-between text-xs text-stone-500 font-mono-tabular">
                    <span>$1.200.000 COP</span>
                    <span>$10.000.000 COP</span>
                    <span>$22.000.000 COP</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-stone-200/80">
                  <label className="block text-sm font-medium text-slate-800 mb-3">
                    Esquema de protección y administración de {operatorName}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => setAdminPlan('esencial')}
                      className={`p-3.5 text-left rounded-lg border transition-colors ${
                        adminPlan === 'esencial'
                          ? 'bg-white border-[#0F2942] text-slate-900'
                          : 'bg-transparent border-stone-200 text-slate-600 hover:border-stone-300'
                      }`}
                    >
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-sm font-semibold">Esencial</span>
                        <span className="text-xs font-mono-tabular font-semibold text-[#0F2942]">8%</span>
                      </div>
                      <p className="text-xs text-stone-500">
                        Cobranza mensual, estados de cuenta y mediación IJA.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAdminPlan('integral')}
                      className={`p-3.5 text-left rounded-lg border transition-colors ${
                        adminPlan === 'integral'
                          ? 'bg-white border-[#0F2942] text-slate-900'
                          : 'bg-transparent border-stone-200 text-slate-600 hover:border-stone-300'
                      }`}
                    >
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-sm font-semibold">Integral</span>
                        <span className="text-xs font-mono-tabular font-semibold text-[#0F2942]">10%</span>
                      </div>
                      <p className="text-xs text-stone-500">
                        Investigación jurídica, gestión de servicios y atención a inquilino.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAdminPlan('garantizada')}
                      className={`p-3.5 text-left rounded-lg border transition-colors ${
                        adminPlan === 'garantizada'
                          ? 'bg-white border-[#0F2942] text-slate-900'
                          : 'bg-transparent border-stone-200 text-slate-600 hover:border-stone-300'
                      }`}
                    >
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="text-sm font-semibold">Patrimonial</span>
                        <span className="text-xs font-mono-tabular font-semibold text-[#0F2942]">12%</span>
                      </div>
                      <p className="text-xs text-stone-500">
                        Renta puntual garantizada día 5 + blindaje jurídico total.
                      </p>
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-stone-200/80 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      Fondo de Conservación Preventiva (Impermeabilización, Pintura y Clima)
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Reserva del 3.5% mensual para mantener el inmueble en estado óptimo sin desembolsos extraordinarios.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={includePreventivePack}
                    onClick={() => setIncludePreventivePack(!includePreventivePack)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 border ${
                      includePreventivePack
                        ? 'bg-[#14532D] text-white border-[#14532D]'
                        : 'bg-white text-slate-700 border-stone-300'
                    }`}
                  >
                    {includePreventivePack ? 'Incluido (3.5%)' : 'No incluido'}
                  </button>
                </div>
              </div>

              {/* Right Column: Tabular Output */}
              <div className="lg:col-span-5 p-6 md:p-8 bg-white flex flex-col justify-between">
                <div className="space-y-5">
                  <div className="flex items-center justify-between border-b border-stone-200 pb-4">
                    <span className="text-xs font-medium text-stone-500">
                      Proyección Anual para el Propietario
                    </span>
                    <ShieldCheck className="w-4 h-4 text-[#14532D]" />
                  </div>

                  <div>
                    <p className="text-xs text-stone-500 mb-1">Ingreso Neto Anual Estimado</p>
                    <p className="text-3xl font-semibold text-slate-900 font-mono-tabular tracking-tight">
                      {formatMoney(adminResults.netAnnualOwner)}
                    </p>
                    <p className="text-xs text-slate-600 mt-1 font-mono-tabular">
                      Depósito mensual libre: {formatMoney(adminResults.netMonthlyOwner)} / mes
                    </p>
                  </div>

                  <dl className="space-y-2.5 pt-4 border-t border-stone-200 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Renta bruta mensual</dt>
                      <dd className="font-mono-tabular font-medium text-slate-900">
                        {formatMoney(monthlyRent)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-600">
                        Honorario administración ({adminResults.feeRatePct}%)
                      </dt>
                      <dd className="font-mono-tabular text-slate-700">
                        - {formatMoney(adminResults.monthlyFee)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Reserva mantenimiento preventivo</dt>
                      <dd className="font-mono-tabular text-slate-700">
                        - {formatMoney(adminResults.preventiveReserve)}
                      </dd>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-stone-200/80 text-xs text-[#14532D]">
                      <dt>Riesgo evitado por morosidad / vacancia</dt>
                      <dd className="font-mono-tabular font-semibold">
                        {formatMoney(adminResults.unshieldedRiskCost)} / año
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="pt-6 mt-6 border-t border-stone-200">
                  <button
                    type="button"
                    onClick={() =>
                      onRequestDiagnostic(
                        `Solicitud de Póliza de Administración (${adminPlan.toUpperCase()}): Renta estimada ${formatMoney(
                          monthlyRent
                        )}/mes · Neto anual proyectado ${formatMoney(adminResults.netAnnualOwner)}.`
                      )
                    }
                    className="w-full py-3 px-4 bg-[#0F2942] hover:bg-[#163859] text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <span>Solicitar Propuesta de Administración</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'hipoteca' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-stone-200/90">
              <div className="lg:col-span-7 p-6 md:p-8 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">
                    Corrida Hipotecaria y Proyección de Plusvalía a 5 Años
                  </h3>
                  <p className="text-sm text-slate-600">
                    Calcula tu mensualidad bancaria, gastos notariales y registrales estimados y crecimiento patrimonial esperado.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="prop-value-slider" className="text-sm font-medium text-slate-800">
                      Valor del inmueble a adquirir
                    </label>
                    <span className="text-base font-semibold text-[#0F2942] font-mono-tabular">
                      {formatMoney(propertyValue)}
                    </span>
                  </div>
                  <input
                    id="prop-value-slider"
                    type="range"
                    min={4500000}
                    max={40000000}
                    step={500000}
                    value={propertyValue}
                    onChange={(e) => setPropertyValue(Number(e.target.value))}
                    className="w-full accent-[#0F2942] cursor-pointer h-2 bg-stone-200 rounded-lg"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-stone-200/80">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <label htmlFor="downpayment-slider" className="font-medium text-slate-800">
                        Enganche inicial
                      </label>
                      <span className="font-mono-tabular font-semibold text-slate-900">
                        {downPaymentPct}% ({formatMoney(mortgageResults.downPayment)})
                      </span>
                    </div>
                    <input
                      id="downpayment-slider"
                      type="range"
                      min={10}
                      max={70}
                      step={5}
                      value={downPaymentPct}
                      onChange={(e) => setDownPaymentPct(Number(e.target.value))}
                      className="w-full accent-[#0F2942] cursor-pointer h-2 bg-stone-200 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-800 mb-2">
                      Plazo del crédito hipotecario
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {([10, 15, 20] as const).map((yr) => (
                        <button
                          key={yr}
                          type="button"
                          onClick={() => setTermYears(yr)}
                          className={`py-2 px-3 text-xs font-medium rounded-lg border transition-colors font-mono-tabular whitespace-nowrap ${
                            termYears === yr
                              ? 'bg-[#0F2942] text-white border-[#0F2942]'
                              : 'bg-white text-slate-700 border-stone-200 hover:border-stone-300'
                          }`}
                        >
                          {yr} años
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-stone-200/80">
                  <label className="block text-sm font-medium text-slate-800 mb-2">
                    Corredor inmobiliario para tasa de plusvalía histórica
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(Object.keys(ZONE_VALUATION_BENCHMARKS) as Property['neighborhood'][]).map((zone) => (
                      <button
                        key={zone}
                        type="button"
                        onClick={() => setSelectedZone(zone)}
                        className={`py-2 px-3 text-xs font-medium rounded-lg border text-left transition-colors truncate ${
                          selectedZone === zone
                            ? 'bg-white border-[#0F2942] text-[#0F2942] font-semibold'
                            : 'bg-transparent border-stone-200 text-slate-600 hover:border-stone-300'
                        }`}
                      >
                        {zone} ({ZONE_VALUATION_BENCHMARKS[zone].annualAppreciationPct}% anual)
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 p-6 md:p-8 bg-white flex flex-col justify-between">
                <div className="space-y-5">
                  <div className="flex items-center justify-between border-b border-stone-200 pb-4">
                    <span className="text-xs font-medium text-stone-500">
                      Desglose Financiero y Plusvalía en {selectedZone}
                    </span>
                    <TrendingUp className="w-4 h-4 text-[#0F2942]" />
                  </div>

                  <div>
                    <p className="text-xs text-stone-500 mb-1">Valor Proyectado a 5 Años</p>
                    <p className="text-3xl font-semibold text-slate-900 font-mono-tabular tracking-tight">
                      {formatMoney(mortgageResults.valueIn5Years)}
                    </p>
                    <p className="text-xs text-[#14532D] font-medium mt-1 font-mono-tabular">
                      Ganancia de capital estimada: +{formatMoney(mortgageResults.capitalGain5Years)}
                    </p>
                  </div>

                  <dl className="space-y-2.5 pt-4 border-t border-stone-200 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Monto de financiamiento ({100 - downPaymentPct}%)</dt>
                      <dd className="font-mono-tabular font-medium text-slate-900">
                        {formatMoney(mortgageResults.loanAmount)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Mensualidad hipotecaria estimada</dt>
                      <dd className="font-mono-tabular font-semibold text-[#0F2942]">
                        {formatMoney(mortgageResults.monthlyPayment)} / mes
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Gastos notariales e ISABI (aprox. 4.8%)</dt>
                      <dd className="font-mono-tabular text-slate-700">
                        {formatMoney(mortgageResults.closingCostsColombia)}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="pt-6 mt-6 border-t border-stone-200">
                  <button
                    type="button"
                    onClick={() =>
                      onRequestDiagnostic(
                        `Precalificación Hipotecaria y Patrimonial en ${selectedZone}: Inmueble de ${formatMoney(
                          propertyValue
                        )} con enganche de ${downPaymentPct}% a ${termYears} años.`
                      )
                    }
                    className="w-full py-3 px-4 bg-[#0F2942] hover:bg-[#163859] text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <span>Agendar Dictamen Financiero e Hipotecario</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'valuacion' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-stone-200/90">
              <div className="lg:col-span-7 p-6 md:p-8 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">
                    Estimador de Valor Comercial por Metro Cuadrado en Colombia
                  </h3>
                  <p className="text-sm text-slate-600">
                    Obtén una referencia comercial orientativa basada en la información disponible en la plataforma. La valoración definitiva corresponde a la inmobiliaria y/o al profesional responsable.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="val-zone-select" className="block text-sm font-medium text-slate-800 mb-2">
                      Zona / Colonia
                    </label>
                    <select
                      id="val-zone-select"
                      value={valZone}
                      onChange={(e) => setValZone(e.target.value as Property['neighborhood'])}
                      className="w-full px-3.5 py-2.5 bg-white border border-stone-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-[#0F2942]"
                    >
                      {(Object.keys(ZONE_VALUATION_BENCHMARKS) as Property['neighborhood'][]).map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-800 mb-2">
                      Estado de conservación
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'nuevo', label: 'Nuevo' },
                          { id: 'excelente', label: 'Óptimo' },
                          { id: 'remodelar', label: 'A actualizar' }
                        ] as const
                      ).map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setConservationState(st.id)}
                          className={`py-2 px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                            conservationState === st.id
                              ? 'bg-[#0F2942] text-white border-[#0F2942]'
                              : 'bg-white text-slate-700 border-stone-200 hover:border-stone-300'
                          }`}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-stone-200/80">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <label htmlFor="land-m2" className="font-medium text-slate-800">
                        Superficie de Terreno
                      </label>
                      <span className="font-mono-tabular font-semibold text-slate-900">{landM2} m²</span>
                    </div>
                    <input
                      id="land-m2"
                      type="range"
                      min={90}
                      max={1200}
                      step={10}
                      value={landM2}
                      onChange={(e) => setLandM2(Number(e.target.value))}
                      className="w-full accent-[#0F2942] cursor-pointer h-2 bg-stone-200 rounded-lg"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <label htmlFor="const-m2" className="font-medium text-slate-800">
                        Superficie Construida
                      </label>
                      <span className="font-mono-tabular font-semibold text-slate-900">{constM2} m²</span>
                    </div>
                    <input
                      id="const-m2"
                      type="range"
                      min={80}
                      max={1100}
                      step={10}
                      value={constM2}
                      onChange={(e) => setConstM2(Number(e.target.value))}
                      className="w-full accent-[#0F2942] cursor-pointer h-2 bg-stone-200 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 p-6 md:p-8 bg-white flex flex-col justify-between">
                <div className="space-y-5">
                  <div className="flex items-center justify-between border-b border-stone-200 pb-4">
                    <span className="text-xs font-medium text-stone-500">
                      Opinión de Valor Preliminar · {valZone}
                    </span>
                    <Calculator className="w-4 h-4 text-[#0F2942]" />
                  </div>

                  <div>
                    <p className="text-xs text-stone-500 mb-1">Valor Comercial Estimado</p>
                    <p className="text-3xl font-semibold text-slate-900 font-mono-tabular tracking-tight">
                      {formatMoney(valuationResults.estimatedCommercialValue)}
                    </p>
                    <p className="text-xs text-stone-500 mt-1 font-mono-tabular">
                      Rango de mercado: {formatMoney(valuationResults.lowRange)} – {formatMoney(valuationResults.highRange)}
                    </p>
                  </div>

                  <dl className="space-y-2.5 pt-4 border-t border-stone-200 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Precio promedio por m² en {valZone}</dt>
                      <dd className="font-mono-tabular font-medium text-slate-900">
                        {formatMoney(valuationResults.benchmark.avgPricePerM2MXN)} / m²
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Renta mensual estimada</dt>
                      <dd className="font-mono-tabular font-semibold text-[#14532D]">
                        {formatMoney(valuationResults.estimatedMonthlyRent)} / mes
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-600">Tiempo promedio de colocación</dt>
                      <dd className="font-mono-tabular text-slate-700">
                        {valuationResults.benchmark.avgDaysToLease} días
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="pt-6 mt-6 border-t border-stone-200">
                  <button
                    type="button"
                    onClick={() =>
                      onRequestDiagnostic(
                        `Solicitar Avalúo Comercial Presencial en ${valZone}: ${landM2} m² terreno / ${constM2} m² construcción. Valor preliminar: ${formatMoney(
                          valuationResults.estimatedCommercialValue
                        )}.`
                      )
                    }
                    className="w-full py-3 px-4 bg-[#0F2942] hover:bg-[#163859] text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <span>Solicitar Visita de Valuación sin Costo</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
