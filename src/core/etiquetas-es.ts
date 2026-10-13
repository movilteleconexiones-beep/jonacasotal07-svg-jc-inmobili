/**
 * Etiquetas del sistema para usuarios de habla hispana.
 * Las claves permanecen en inglés para preservar contratos con Supabase,
 * migraciones, RLS y conexiones entre módulos.
 * No traducir texto libre ingresado por personas.
 */
const ETIQUETAS: Record<string,string> = {
  // Estados comunes
  ACTIVE:'Activo', INACTIVE:'Inactivo', SUSPENDED:'Suspendido',
  PENDING:'Pendiente', PAID:'Pagado', PARTIAL:'Abonado parcialmente',
  LATE:'Vencido', OVERDUE:'Vencido', CANCELLED:'Cancelado', CANCELED:'Cancelado',
  DRAFT:'Borrador', APPROVED:'Aprobado', REJECTED:'Rechazado',
  VOIDED:'Anulado', GENERATED:'Generado', ISSUED:'Emitido',
  FINISHED:'Finalizado', EXPIRED:'Vencido', EXPIRING:'Próximo a vencer',
  RENEWAL:'En renovación', TERMINATED:'Terminado', CLOSED:'Cerrado',
  OPEN:'Abierto', AVAILABLE:'Disponible', RESERVED:'Reservado',
  RENTED:'Arrendado', SOLD:'Vendido', UNAVAILABLE:'No disponible',
  OCCUPIED:'Ocupado', ARCHIVED:'Archivado', DELETED:'Eliminado',
  REVIEW:'En revisión', IN_REVIEW:'En revisión', REVIEW_REQUIRED:'Revisión requerida',
  IN_PROGRESS:'En proceso', PROCESSING:'Procesando', FAILED:'Fallido',
  COMPLETED:'Completado', CONFIRMED:'Confirmado', SCHEDULED:'Programado',
  NO_SHOW:'No asistió', PAYABLE:'Por pagar', APPLIED:'Aplicado',
  NOT_APPLIED:'No aplicado', REFUNDED:'Reintegrado', CHARGEBACK:'Contracargo',
  SUCCESS:'Correcto', ERROR:'Error', WARNING:'Advertencia', ENABLED:'Habilitado',
  DISABLED:'Deshabilitado', VALID:'Válido', INVALID:'Inválido',
  TRIAL:'Prueba', GRACE:'Período de gracia', TEST:'Prueba', SANDBOX:'Entorno de pruebas',
  PRODUCTION:'Producción', MANUAL:'Manual', AUTOMATIC:'Automática',
  // Negocios y prospectos
  INTEREST:'Interés', VISIT:'Visita', VISIT_SCHEDULED:'Visita programada',
  OFFER:'Oferta recibida', NEGOTIATION:'Negociación',
  DOCUMENTATION:'Documentación', CLOSING:'Cierre',
  WON:'Cerrado / ganado', LOST:'Cerrado / perdido',
  NEW:'Nuevo', CONTACTED:'Contactado', QUALIFIED:'Calificado',
  // Operaciones y propiedades
  SALE:'Venta', RENT:'Arriendo', INVESTMENT:'Inversión',
  HOUSE:'Casa', CASA:'Casa', APARTMENT:'Apartamento', APARTAMENTO:'Apartamento', APARTAESTUDIO:'Apartaestudio', APARTA_ESTUDIO:'Apartaestudio',
  STUDIO:'Apartaestudio', OFFICE:'Oficina', OFICINA:'Oficina', COMMERCIAL:'Comercial',
  COMMERCIAL_SPACE:'Local comercial', RETAIL:'Local comercial',
  LAND:'Lote', LOT:'Lote', LOTE:'Lote', WAREHOUSE:'Bodega', BODEGA:'Bodega', LOCAL:'Local comercial',
  BUILDING:'Edificio', EDIFICIO:'Edificio', FARM:'Finca', FINCA:'Finca', RURAL:'Rural', OTHER:'Otro', OTRO:'Otro',
  // Citas y prioridades
  MEETING:'Reunión', CALL:'Llamada', FOLLOW_UP:'Seguimiento',
  LOW:'Baja', MEDIUM:'Media', HIGH:'Alta', URGENT:'Urgente',
  // Comisiones y responsables
  AGENT:'Asesor', CAPTOR:'Captador', COORDINATOR:'Coordinador',
  REFERRAL:'Referido', COMPANY:'Inmobiliaria',
  OWNER:'Propietario', TENANT:'Inquilino', AGENCY:'Inmobiliaria',
  ADMIN:'Administrador', ADMINISTRATOR:'Administrador',
  PLATFORM_ADMIN:'Superadministrador', SUPER_ADMIN:'Superadministrador',
  CLIENT:'Cliente', CUSTOMER:'Cliente', USER:'Usuario',
  // Documentos y pagos
  CONTRACT:'Contrato', CERTIFICATE:'Certificado', PROPERTY_TITLE:'Escritura',
  INVOICE:'Factura / soporte', ID:'Identificación', GENERAL:'General',
  PROPERTY:'Propiedad', CONTACT:'Cliente / contacto', LEAD:'Prospecto',
  DEAL:'Negocio', BANK_TRANSFER:'Transferencia bancaria',
  CASH:'Efectivo', CARD:'Tarjeta', CREDIT_CARD:'Tarjeta de crédito',
  DEBIT_CARD:'Tarjeta débito',
  // Conceptos de gastos y deducciones
  WATER:'Agua', ELECTRICITY:'Energía', GAS:'Gas', WASTE:'Aseo',
  BUILDING_FEE:'Administración', MAINTENANCE:'Mantenimiento',
  REPAIRS:'Reparaciones', INSURANCE:'Seguro', TAX:'Impuestos',
  COMMISSION:'Comisión', TAXES:'Impuestos', UTILITIES:'Servicios públicos',
  // Ciclos y licenciamiento
  MONTHLY:'Mensual', ANNUAL:'Anual', YEARLY:'Anual',
  SAAS:'Servicio de software', SUBSCRIPTION:'Suscripción',
};

function formatCode(value: string | null | undefined): string {
  if (value == null || value.trim()==='') return 'Sin especificar';
  const code=value.trim().toUpperCase().replace(/[\s-]+/g,'_');
  if (ETIQUETAS[code]) return ETIQUETAS[code];
  // Conservar los valores personalizados y nombres de tipos de inmueble
  // en lugar de ocultarlos; el catálogo cubre los códigos conocidos.
  return value;
}

/** Etiqueta en español para un estado, categoría, etapa o tipo codificado. */
export function etiquetaES(value: string | null | undefined): string {
  return formatCode(value);
}

/** Etapas del embudo comercial; los valores se envían intactos a Supabase. */
export const ETAPAS_NEGOCIO = [
  ['INTEREST','Interés'], ['VISIT','Visita'], ['OFFER','Oferta recibida'],
  ['NEGOTIATION','Negociación'], ['DOCUMENTATION','Documentación'],
  ['CLOSING','Cierre'], ['WON','Cerrado / ganado'],
  ['LOST','Cerrado / perdido'],
] as const;

/** Permite validar catálogos de traducción sin cambiar los códigos de negocio. */
export function tieneTraduccionES(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(ETIQUETAS,code.toUpperCase());
}
