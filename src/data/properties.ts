// Synced source: property catalogue used by the public portal.
export interface Property {
  id: string;
  code: string;
  title: string;
  neighborhood: 'El Poblado' | 'Chicó' | 'Envigado' | 'Laureles' | 'Usaquén' | 'Ciudad del Río';
  municipality: 'Medellín, Antioquia' | 'Bogotá, D.C.';
  operation: 'Venta' | 'Renta' | 'Administración';
  category: 'Residencial' | 'Departamento' | 'Comercial y Terreno';
  priceCOP: number;
  monthlyRentEstimationCOP: number;
  maintenanceFeeCOP: number;
  landAreaM2: number;
  constructionAreaM2: number;
  bedrooms: number;
  bathrooms: number;
  parkingSpaces: number;
  annualAppreciationPct: number;
  rentalYieldPct: number;
  image: string;
  secondaryImage: string;
  legalStatus: string;
  architecturalSummary: string;
  highlights: string[];
  domoticsAndMaintenance: string[];
  coordinatesLabel: string;
  yearBuilt: number;
}

export interface AcademyModule {
  id: string;
  number: string;
  title: string;
  audience: string;
  durationHours: number;
  modality: 'Presencial en Medellín' | 'Híbrido Ejecutivo' | 'En Línea en Vivo';
  nextCohortDate: string;
  priceCOP: number;
  summary: string;
  topics: string[];
  instructor: string;
}

export interface CaseStudy {
  id: string;
  propertyCode: string;
  neighborhood: string;
  serviceApplied: string;
  metricHeadline: string;
  timeframe: string;
  clientName: string;
  clientRole: string;
  organization: string;
  beforeState: string;
  intervention: string;
  outcome: string;
}

export const HERO_IMAGE = '/src/assets/images/hero_zapopan_residence_1791081912330.jpg';

export const PROPERTIES: Property[] = [
  {
    id: 'prop-1',
    code: 'JC-1084',
    title: 'Residencia Contemporánea en El Poblado',
    neighborhood: 'El Poblado',
    municipality: 'Medellín, Antioquia',
    operation: 'Venta',
    category: 'Residencial',
    priceCOP: 34800000,
    monthlyRentEstimationCOP: 145000,
    maintenanceFeeCOP: 6800,
    landAreaM2: 640,
    constructionAreaM2: 785,
    bedrooms: 4,
    bathrooms: 5.5,
    parkingSpaces: 6,
    annualAppreciationPct: 11.4,
    rentalYieldPct: 6.2,
    image: '/src/assets/images/hero_zapopan_residence_1791081912330.jpg',
    secondaryImage: '/src/assets/images/prop_valle_real_villa_1791081939659.jpg',
    legalStatus: 'Escritura pública libre de gravamen · Dictamen jurídico verificado',
    architecturalSummary:
      'Residencia de autor con muros de concreto aparente enduelado, celosías de madera de parota certificada y piscina infinita climatizada con orientación sur-norte.',
    highlights: [
      'Doble altura con cristal templado Low-E de piso a techo',
      'Cocina de autor con isla monolítica en mármol Santo Tomás',
      'Cava subterránea climatizada y terraza con espejo de agua',
      'Seguridad perimetral 24/7 en unidad residencial privado de alta plusvalía'
    ],
    domoticsAndMaintenance: [
      'Automatización integral Lutron (iluminación, persianas motorizadas y audio)',
      'Impermeabilización elastomérica con póliza vigente por 8 años',
      'Sistema fotovoltaico de 18 paneles con inversor híbrido',
      'Climatización VRF zonificada en las 4 suites'
    ],
    coordinatesLabel: 'Unidad residencial Asturias · El Poblado, Medellín',
    yearBuilt: 2025
  },
  {
    id: 'prop-2',
    code: 'JC-2041',
    title: 'Penthouse Corporativo en Chicó',
    neighborhood: 'Chicó',
    municipality: 'Medellín, Antioquia',
    operation: 'Venta',
    category: 'Departamento',
    priceCOP: 24500000,
    monthlyRentEstimationCOP: 118000,
    maintenanceFeeCOP: 9200,
    landAreaM2: 340,
    constructionAreaM2: 340,
    bedrooms: 3,
    bathrooms: 3.5,
    parkingSpaces: 4,
    annualAppreciationPct: 12.1,
    rentalYieldPct: 6.8,
    image: '/src/assets/images/prop_andares_penthouse_1791081925896.jpg',
    secondaryImage: '/src/assets/images/prop_providencia_loft_1791081951676.jpg',
    legalStatus: 'Régimen en condominio al corriente · Póliza patrimonial lista',
    architecturalSummary:
      'Penthouse de doble altura con terraza panorámica hacia el corredor financiero de Chicó, pisos de mármol travertino cepillado y elevador directo a vestíbulo privado.',
    highlights: [
      'Terraza perimetral de 65 m² con vista despejada a Zona Chicó',
      'Acceso peatonal directo a restaurantes, corporativos y centros comerciales',
      '3 habitaciones con vestidor en carpintería de encino americano',
      'Cuarto de servicio independiente y bodega en sótano nivel 1'
    ],
    domoticsAndMaintenance: [
      'Cerradura biométrica inteligente y control de acceso para visitas',
      'Cortinas enrollables motorizadas Blackout y malla solar en estancia',
      'Aire acondicionado central Inverter con termostatos inteligentes',
      'Mantenimiento preventivo de cancelería acústica certificado por Sistema Inmobiliario JCO'
    ],
    coordinatesLabel: 'Av. Patria y Blvd. El Poblado · Medellín',
    yearBuilt: 2024
  },
  {
    id: 'prop-3',
    code: 'JC-3019',
    title: 'Casa Campestre Contemporánea en Envigado',
    neighborhood: 'Envigado',
    municipality: 'Medellín, Antioquia',
    operation: 'Renta',
    category: 'Residencial',
    priceCOP: 28900000,
    monthlyRentEstimationCOP: 98000,
    maintenanceFeeCOP: 5400,
    landAreaM2: 520,
    constructionAreaM2: 610,
    bedrooms: 4,
    bathrooms: 4.5,
    parkingSpaces: 4,
    annualAppreciationPct: 10.6,
    rentalYieldPct: 6.4,
    image: '/src/assets/images/prop_valle_real_villa_1791081939659.jpg',
    secondaryImage: '/src/assets/images/hero_zapopan_residence_1791081912330.jpg',
    legalStatus: 'Contrato con investigación jurídica y convenio de mediación',
    architecturalSummary:
      'Residencia contemporánea mexicana con fachada de piedra cantera natural, losas en voladizo y patio central arbolado que integra luz natural todo el día.',
    highlights: [
      'Administración integral Sistema Inmobiliario JCO incluida en el esquema de arrendamiento',
      'Estudio en planta baja con baño completo adaptable a quinta habitación',
      'Jardín interior con olivos centenarios y riego automatizado',
      'Club privado con canchas de tenis, piscina semiolímpica y gimnasio'
    ],
    domoticsAndMaintenance: [
      'Póliza de mantenimiento preventivo (impermeabilización y pintura recién ejecutadas)',
      'Sistema de alarma y circuito cerrado de 8 cámaras de alta definición',
      'Hidroneumático silencioso con suavizador y filtro de carbón activado',
      'Iluminación arquitectónica cálida programable por escenas'
    ],
    coordinatesLabel: 'Paseo de San Arturo · Envigado, Medellín',
    yearBuilt: 2023
  },
  {
    id: 'prop-4',
    code: 'JC-4012',
    title: 'Apartamento Boutique en Laureles',
    neighborhood: 'Laureles',
    municipality: 'Bogotá, D.C.',
    operation: 'Renta',
    category: 'Departamento',
    priceCOP: 7950000,
    monthlyRentEstimationCOP: 36500,
    maintenanceFeeCOP: 3400,
    landAreaM2: 168,
    constructionAreaM2: 168,
    bedrooms: 2,
    bathrooms: 2.5,
    parkingSpaces: 2,
    annualAppreciationPct: 10.2,
    rentalYieldPct: 7.4,
    image: '/src/assets/images/prop_providencia_loft_1791081951676.jpg',
    secondaryImage: '/src/assets/images/prop_andares_penthouse_1791081925896.jpg',
    legalStatus: 'Arrendamiento protegido · Investigación socioeconómica en 48 h',
    architecturalSummary:
      'Unidad exterior en nivel 6 dentro de torre boutique de sólo 18 departamentos en Laureles Norte, con carpintería de roble natural e isla de travertino.',
    highlights: [
      'Ubicación privilegiada a dos cuadras del corredor gastronómico de Rubén Darío',
      'Ventanales acústicos de piso a techo con balcón arbolado',
      'Alta rentabilidad por demanda ejecutiva y corporativa en Laureles',
      'Lobby con conserjería 24 horas y roof garden con sala de juntas'
    ],
    domoticsAndMaintenance: [
      'Persianas translúcidas y blackout instaladas por división de equipamiento JC',
      'Climatización minisplit Inverter en sala y ambas habitaciones',
      'Chapa digital con código temporal para visitas y mantenimiento',
      'Revisión anual de instalaciones hidráulicas y gas certificada'
    ],
    coordinatesLabel: 'Barrio Laureles Norte · Bogotá',
    yearBuilt: 2024
  },
  {
    id: 'prop-5',
    code: 'JC-5028',
    title: 'Residencia Urbana en Usaquén',
    neighborhood: 'Usaquén',
    municipality: 'Medellín, Antioquia',
    operation: 'Venta',
    category: 'Residencial',
    priceCOP: 11400000,
    monthlyRentEstimationCOP: 46000,
    maintenanceFeeCOP: 2200,
    landAreaM2: 220,
    constructionAreaM2: 315,
    bedrooms: 3,
    bathrooms: 4.5,
    parkingSpaces: 3,
    annualAppreciationPct: 11.8,
    rentalYieldPct: 6.9,
    image: '/src/assets/images/prop_solares_house_1791081961290.jpg',
    secondaryImage: '/src/assets/images/prop_valle_real_villa_1791081939659.jpg',
    legalStatus: 'Apta para crédito hipotecario, leasing habitacional o recursos propios',
    architecturalSummary:
      'Volúmenes arquitectónicos puros con celosías térmicas, roof garden con pergolado y acceso inmediato al lago y parque lineal de Usaquén Residencial.',
    highlights: [
      'Frente a parque central dentro de unidad residencial con casa club y piscina templada',
      'Roof garden en tercer nivel con barra de granito y baño completo',
      'A 5 minutos de colegios de prestigio y corredor comercial Tec de Monterrey',
      'Excelente relación precio por metro cuadrado en la zona poniente de Medellín'
    ],
    domoticsAndMaintenance: [
      'Preparación completa para domótica, paneles solares y cargador de auto eléctrico',
      'Impermeabilización fibratada con garantía escrita',
      'Pintura vinílica lavable de grado arquitectónico interior y exterior',
      'Cisterna de 8,000 litros con bomba sumergible de presión constante'
    ],
    coordinatesLabel: 'Paseo del Amanecer · Usaquén, Medellín',
    yearBuilt: 2025
  },
  {
    id: 'prop-6',
    code: 'JC-6090',
    title: 'Edificio Mixto Ciudad del Río',
    neighborhood: 'Ciudad del Río',
    municipality: 'Medellín, Antioquia',
    operation: 'Administración',
    category: 'Comercial y Terreno',
    priceCOP: 16200000,
    monthlyRentEstimationCOP: 88000,
    maintenanceFeeCOP: 3100,
    landAreaM2: 410,
    constructionAreaM2: 580,
    bedrooms: 6,
    bathrooms: 6,
    parkingSpaces: 8,
    annualAppreciationPct: 9.8,
    rentalYieldPct: 8.5,
    image: '/src/assets/images/prop_andares_penthouse_1791081925896.jpg',
    secondaryImage: '/src/assets/images/prop_solares_house_1791081961290.jpg',
    legalStatus: 'Uso de suelo mixto CS2 verificado · Licencias municipales vigentes',
    architecturalSummary:
      'Inmueble productivo de 3 niveles con local comercial en planta baja y oficinas/suites corporativas en niveles superiores sobre corredor consolidado en Ciudad del Río y La Calma.',
    highlights: [
      'Ideal para inversionistas patrimoniales que buscan flujo mensual inmediato',
      'Gestionado al 100% bajo Póliza de Administración Integral Sistema Inmobiliario JCO',
      'Estacionamiento frontal para 8 vehículos en batería sobre avenida principal',
      'Conectividad inmediata a Av. López Mateos Sur, Mariano Otero y Patria'
    ],
    domoticsAndMaintenance: [
      'Control de acceso peatonal y vehicular automatizado por nivel',
      'Subestación eléctrica bifásica/trifásica con balanceo de cargas',
      'Mantenimiento integral preventivo trimestral (clima, pintura e impermeabilización)',
      'Monitoreo de alarma conectado a central 24/7'
    ],
    coordinatesLabel: 'Ciudad del Río · Medellín',
    yearBuilt: 2022
  }
];

export const ZONE_VALUATION_BENCHMARKS: Record<
  Property['neighborhood'],
  { avgPricePerM2MXN: number; annualAppreciationPct: number; avgDaysToLease: number; avgYieldPct: number }
> = {
  'El Poblado': {
    avgPricePerM2MXN: 46500,
    annualAppreciationPct: 11.4,
    avgDaysToLease: 26,
    avgYieldPct: 6.2
  },
  Chicó: {
    avgPricePerM2MXN: 71800,
    annualAppreciationPct: 12.1,
    avgDaysToLease: 19,
    avgYieldPct: 6.8
  },
  'Envigado': {
    avgPricePerM2MXN: 44200,
    annualAppreciationPct: 10.6,
    avgDaysToLease: 24,
    avgYieldPct: 6.4
  },
  Laureles: {
    avgPricePerM2MXN: 47900,
    annualAppreciationPct: 10.2,
    avgDaysToLease: 16,
    avgYieldPct: 7.4
  },
  Usaquén: {
    avgPricePerM2MXN: 36400,
    annualAppreciationPct: 11.8,
    avgDaysToLease: 21,
    avgYieldPct: 6.9
  },
  'Ciudad del Río': {
    avgPricePerM2MXN: 31200,
    annualAppreciationPct: 9.8,
    avgDaysToLease: 18,
    avgYieldPct: 8.5
  }
};

export const CASE_STUDIES: CaseStudy[] = [
  {
    id: 'case-1',
    propertyCode: 'Portafolio Residencial Envigado (4 Unidades)',
    neighborhood: 'Envigado & Usaquén, Medellín',
    serviceApplied: '02. Administración Integral y Blindaje de Arrendamiento',
    metricHeadline: '99.4% Cobranza Puntual y +22% Rentabilidad Neta en 12 Meses',
    timeframe: 'Periodo 2025–2026 (12 meses auditados)',
    clientName: 'Ing. Carlos Alberto Montes de Oca',
    clientRole: 'Propietario e Inversionista Patrimonial',
    organization: 'Grupo Industrial de Occidente',
    beforeState:
      'Tres propiedades residenciales presentaban rotación frecuente de inquilinos, retrasos de pago de hasta 45 días y deterioro por falta de mantenimiento preventivo en azoteas y equipos de aire acondicionado.',
    intervention:
      'Sistema Inmobiliario JCO implementó dictaminación jurídica de prospectos, contratos ratificados con mecanismos de conciliación en Colombia, cobranza sistematizada y plan anual de impermeabilización, pintura y domótica.',
    outcome:
      'Ocupación continua del 100% durante los últimos 14 meses, depósito puntual antes del día 5 de cada mes y reducción del 38% en costos correctivos de mantenimiento.'
  },
  {
    id: 'case-2',
    propertyCode: 'Operación de Compraventa JC-1049',
    neighborhood: 'El Poblado, Medellín',
    serviceApplied: '01. Promoción Estratégica y Cierre Notarial',
    metricHeadline: 'Venta Cerrada en 34 Días al 98.7% del Valor de Lista ($3.120 millones COP)',
    timeframe: 'Cierre completado en 5 semanas',
    clientName: 'Arq. Sofía Villaseñor Madrigal',
    clientRole: 'Directora de Desarrollo Residencial',
    organization: 'Taller V+M Arquitectura',
    beforeState:
      'La residencia llevaba 7 meses listada en portales genéricos sin filtro de compradores calificados ni estrategia fiscal para exención y deducción de mejoras.',
    intervention:
      'Ejecutamos avalúo comercial comparativo, producción audiovisual arquitectónica, filtrado financiero de compradores en Colombia y estructuración jurídica con acompañamiento notarial y registral en Colombia.',
    outcome:
      'Presentación de 6 prospectos precalificados en las primeras 3 semanas y firma de escritura definitiva en el día 34 sin contingencias legales.'
  },
  {
    id: 'case-3',
    propertyCode: 'Rehabilitación y Equipamiento JC-4088',
    neighborhood: 'Barrio Laureles, Bogotá',
    serviceApplied: '04. Mantenimiento Residencial, Persianas y Domótica',
    metricHeadline: '+18.5% Incremento en Valor de Renta Mensual tras Adecuación en 15 Días',
    timeframe: 'Ejecución de obra ligera: 15 días naturales',
    clientName: 'Dra. Elena Covarrubias Tello',
    clientRole: 'Propietaria de Departamento en Renta Ejecutiva',
    organization: 'Centro Médico El Poblado',
    beforeState:
      'El departamento permaneció desocupado 3 meses debido a acabados desgastados, falta de aire acondicionado y ausencia de cortinas motorizadas solicitadas por ejecutivos.',
    intervention:
      'El equipo técnico de Sistema Inmobiliario JCO realizó pintura arquitectónica, instalación de minisplits Inverter, persianas enrollables motorizadas, chapa inteligente y alarma.',
    outcome:
      'Arrendado en la primera semana posterior a la entrega con una renta mensual de $4.850.000 COP (frente a los $4.100.000 COP proyectados originalmente).'
  }
];

export const ACADEMY_MODULES: AcademyModule[] = [
  {
    id: 'acad-1',
    number: 'Módulo 01',
    title: 'Blindaje Jurídico en Arrendamiento y Justicia Alternativa en Colombia',
    audience: 'Asesores inmobiliarios, propietarios y administradores de patrimonio',
    durationHours: 16,
    modality: 'Híbrido Ejecutivo',
    nextCohortDate: '18 de Octubre, 2026',
    priceCOP: 4200,
    summary:
      'Domina la estructuración de contratos de arrendamiento habitación y comercial en Colombia, investigación en validación jurídica y financiera, extinción de dominio y convenios de mediación ante el centros de conciliación autorizados.',
    topics: [
      'Investigación socioeconómica, validación de garantías y pólizas jurídicas',
      'Cláusulas de blindaje contra Ley Nacional de Extinción de Dominio',
      'Convenios de transacción y mediación ante el Instituto de Justicia Alternativa',
      'Protocolo de entrega-recepción con inventario fotográfico y pagarés'
    ],
    instructor: 'Dirección Jurídica Sistema Inmobiliario JCO · +18 años de práctica en Colombia'
  },
  {
    id: 'acad-2',
    number: 'Módulo 02',
    title: 'Estimación de Valor, Análisis de Plusvalía y Retorno Patrimonial (CAP Rate)',
    audience: 'Inversionistas, desarrolladores y consultores patrimoniales',
    durationHours: 20,
    modality: 'Presencial en Medellín',
    nextCohortDate: '02 de Noviembre, 2026',
    priceCOP: 5400,
    summary:
      'Metodología práctica para dictaminar el valor comercial real por metro cuadrado en corredores clave de Medellín y Bogotá, calcular flujo neto y estructurar portafolios de renta.',
    topics: [
      'Homologación de comparables de mercado en Chicó, El Poblado, Usaquén y Laureles',
      'Cálculo de CAP Rate bruto vs. neto descontando mantenimiento, predial e ISR',
      'Estrategia fiscal en compraventa: exención de ISR por casa habitación y deducciones autorizadas',
      'Simulación financiera a 5 y 10 años para toma de decisiones patrimoniales'
    ],
    instructor: 'Comité de Valuación y Finanzas Sistema Inmobiliario JCO'
  },
  {
    id: 'acad-3',
    number: 'Módulo 03',
    title: 'Captación en Exclusiva, Comercialización Digital y Cierre Notarial',
    audience: 'Asesores inmobiliarios en formación y equipos comerciales',
    durationHours: 24,
    modality: 'Presencial en Medellín',
    nextCohortDate: '16 de Noviembre, 2026',
    priceCOP: 4800,
    summary:
      'El sistema operativo comercial de Sistema Inmobiliario JCO: desde la integración del expediente técnico-legal de la propiedad hasta la pauta segmentada en portales y la firma en notaría.',
    topics: [
      'Checklist documental para captación segura (libertad de gravamen, alineamiento, planos)',
      'Presentación de plan de comercialización en Lamudi, Casas y Terrenos, EasyBroker y red privada',
      'Calificación de prospectos con crédito hipotecario bancario, leasing habitacional y contado',
      'Seguimiento de avalúo bancario, carta de instrucción y cierre en Notaría Pública'
    ],
    instructor: 'Dirección Comercial JC Inmobilearning · Sede Colombia'
  }
];
