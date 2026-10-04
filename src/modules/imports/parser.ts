import * as XLSX from 'xlsx';
import type { ImportEntityType, ImportFieldDefinition, ImportPreview } from './types';
import { CONTACT_IMPORT_FIELDS, PROPERTY_IMPORT_FIELDS } from './types';

const normalizeHeader = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

export async function readImportFile(file: File): Promise<ImportPreview> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (!extension || !['csv', 'xlsx', 'xls'].includes(extension)) {
    throw new Error('Formato no soportado. Usa CSV, XLSX o XLS.');
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) throw new Error('El archivo no contiene hojas con datos.');

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (matrix.length === 0) throw new Error('El archivo está vacío.');

  const headers = (matrix[0] ?? []).map((cell) => String(cell ?? '').trim());
  if (headers.every((header) => !header)) throw new Error('No se encontraron encabezados.');

  const rows = matrix.slice(1)
    .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .slice(0, 5000)
    .map((row) => {
      const record: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        record[header || `Columna ${index + 1}`] = row[index] ?? '';
      });
      return record;
    });

  return {
    fileName: file.name,
    fileType: extension.toUpperCase() as ImportPreview['fileType'],
    sheetName,
    headers,
    rows,
  };
}

export function suggestColumnMapping(
  headers: string[],
  entityType: ImportEntityType,
): Record<string, string> {
  const fields = entityType === 'CONTACTS' ? CONTACT_IMPORT_FIELDS : PROPERTY_IMPORT_FIELDS;
  const normalizedHeaders = headers.map((header) => ({
    original: header,
    normalized: normalizeHeader(header),
  }));

  const mapping: Record<string, string> = {};

  for (const field of fields) {
    const candidates = [field.label, field.key, ...(field.aliases ?? [])].map(normalizeHeader);
    const match = normalizedHeaders.find((header) => candidates.includes(header.normalized));
    if (match) mapping[field.key] = match.original;
  }

  return mapping;
}

export function validateMapping(
  mapping: Record<string, string>,
  entityType: ImportEntityType,
): string[] {
  const fields: ImportFieldDefinition[] =
    entityType === 'CONTACTS' ? CONTACT_IMPORT_FIELDS : PROPERTY_IMPORT_FIELDS;

  return fields
    .filter((field) => field.required && !mapping[field.key])
    .map((field) => `Falta mapear el campo obligatorio: ${field.label}`);
}
