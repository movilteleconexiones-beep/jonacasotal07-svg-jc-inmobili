import { supabase } from '../../lib/supabase';
import type { ImportEntityType, ImportPreview } from './types';

export interface CreateImportJobInput {
  organizationId: string;
  userId: string;
  entityType: ImportEntityType;
  preview: ImportPreview;
  mapping: Record<string, string>;
}

export async function createImportJob(input: CreateImportJobInput) {
  if (!supabase) throw new Error('Supabase no está configurado.');

  const { data: job, error: jobError } = await supabase
    .from('import_jobs')
    .insert({
      organization_id: input.organizationId,
      entity_type: input.entityType,
      original_filename: input.preview.fileName,
      file_type: input.preview.fileType,
      status: 'VALIDATING',
      column_mapping: input.mapping,
      total_rows: input.preview.rows.length,
      created_by: input.userId,
    })
    .select('id')
    .single();

  if (jobError) throw jobError;

  const rows = input.preview.rows.map((row, index) => {
    const normalized: Record<string, unknown> = {};

    for (const [targetField, sourceHeader] of Object.entries(input.mapping)) {
      normalized[targetField] = row[sourceHeader] ?? '';
    }

    const validationErrors: string[] = [];

    if (input.entityType === 'CONTACTS' && !String(normalized.first_name ?? '').trim()) {
      validationErrors.push('El nombre es obligatorio.');
    }

    if (input.entityType === 'PROPERTIES') {
      if (!String(normalized.code ?? '').trim()) validationErrors.push('El código es obligatorio.');
      if (!String(normalized.title ?? '').trim()) validationErrors.push('El título es obligatorio.');
      if (!String(normalized.operation_type ?? '').trim()) validationErrors.push('La operación es obligatoria.');
      if (!String(normalized.property_type ?? '').trim()) validationErrors.push('El tipo de inmueble es obligatorio.');
    }

    return {
      import_job_id: job.id,
      row_number: index + 2,
      raw_data: row,
      normalized_data: normalized,
      validation_errors: validationErrors,
      status: validationErrors.length ? 'INVALID' : 'VALID',
    };
  });

  const chunkSize = 250;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const { error } = await supabase.from('import_job_rows').insert(chunk);
    if (error) throw error;
  }

  const validRows = rows.filter((row) => row.status === 'VALID').length;
  const invalidRows = rows.length - validRows;

  const { error: updateError } = await supabase
    .from('import_jobs')
    .update({
      status: invalidRows > 0 ? 'MAPPING' : 'READY',
      valid_rows: validRows,
      invalid_rows: invalidRows,
    })
    .eq('id', job.id);

  if (updateError) throw updateError;

  return {
    id: job.id as string,
    validRows,
    invalidRows,
    totalRows: rows.length,
  };
}
