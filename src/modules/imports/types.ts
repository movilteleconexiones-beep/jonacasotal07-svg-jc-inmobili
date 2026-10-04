export type ImportEntityType = 'CONTACTS' | 'PROPERTIES';
export type ImportFileType = 'CSV' | 'XLSX' | 'XLS';

export interface ImportPreview {
  fileName: string;
  fileType: ImportFileType;
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface ImportFieldDefinition {
  key: string;
  label: string;
  required?: boolean;
  aliases?: string[];
}

export const CONTACT_IMPORT_FIELDS: ImportFieldDefinition[] = [
  { key: 'first_name', label: 'Nombre', required: true, aliases: ['nombre', 'nombres', 'first name'] },
  { key: 'last_name', label: 'Apellido', aliases: ['apellido', 'apellidos', 'last name'] },
  { key: 'email', label: 'Correo', aliases: ['correo', 'correo electronico', 'e-mail'] },
  { key: 'phone', label: 'Teléfono', aliases: ['telefono', 'celular', 'movil', 'móvil'] },
  { key: 'whatsapp', label: 'WhatsApp', aliases: ['whatsapp', 'wa'] },
  { key: 'source', label: 'Origen', aliases: ['origen', 'fuente', 'source'] },
  { key: 'notes', label: 'Notas', aliases: ['nota', 'notas', 'observaciones'] },
  { key: 'external_reference', label: 'Referencia externa', aliases: ['id', 'codigo', 'código', 'referencia'] },
];

export const PROPERTY_IMPORT_FIELDS: ImportFieldDefinition[] = [
  { key: 'code', label: 'Código', required: true, aliases: ['codigo', 'código', 'ref', 'referencia'] },
  { key: 'title', label: 'Título', required: true, aliases: ['titulo', 'título', 'inmueble'] },
  { key: 'description', label: 'Descripción', aliases: ['descripcion', 'descripción'] },
  { key: 'operation_type', label: 'Operación', required: true, aliases: ['operacion', 'operación', 'tipo operacion'] },
  { key: 'property_type', label: 'Tipo de inmueble', required: true, aliases: ['tipo', 'tipo inmueble'] },
  { key: 'price', label: 'Precio', aliases: ['precio', 'valor'] },
  { key: 'currency', label: 'Moneda', aliases: ['moneda', 'currency'] },
  { key: 'city', label: 'Ciudad', aliases: ['ciudad', 'municipio'] },
  { key: 'neighborhood', label: 'Barrio / zona', aliases: ['barrio', 'colonia', 'zona', 'sector'] },
  { key: 'address', label: 'Dirección', aliases: ['direccion', 'dirección'] },
  { key: 'bedrooms', label: 'Habitaciones', aliases: ['habitaciones', 'alcobas', 'recamaras', 'recámaras'] },
  { key: 'bathrooms', label: 'Baños', aliases: ['banos', 'baños'] },
  { key: 'parking_spaces', label: 'Parqueaderos', aliases: ['parqueaderos', 'estacionamientos', 'garajes'] },
  { key: 'built_area', label: 'Área construida', aliases: ['area construida', 'área construida', 'm2 construidos'] },
  { key: 'external_reference', label: 'Referencia externa', aliases: ['id externo', 'codigo externo'] },
];
