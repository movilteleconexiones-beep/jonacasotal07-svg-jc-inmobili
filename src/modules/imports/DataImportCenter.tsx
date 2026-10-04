import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { createImportJob } from './import-service';
import { readImportFile, suggestColumnMapping, validateMapping } from './parser';
import {
  CONTACT_IMPORT_FIELDS,
  PROPERTY_IMPORT_FIELDS,
  type ImportEntityType,
  type ImportPreview,
} from './types';

export function DataImportCenter() {
  const { user, activeMembership } = useAuth();
  const [entityType, setEntityType] = useState<ImportEntityType>('CONTACTS');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const fields = entityType === 'CONTACTS' ? CONTACT_IMPORT_FIELDS : PROPERTY_IMPORT_FIELDS;
  const mappingErrors = useMemo(() => validateMapping(mapping, entityType), [mapping, entityType]);

  async function handleFile(file?: File) {
    if (!file) return;
    setMessage('');
    try {
      const next = await readImportFile(file);
      setPreview(next);
      setMapping(suggestColumnMapping(next.headers, entityType));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo leer el archivo.');
    }
  }

  async function prepareImport() {
    if (!preview || !user || !activeMembership) return;
    if (mappingErrors.length) {
      setMessage(mappingErrors.join(' '));
      return;
    }

    setBusy(true);
    try {
      const result = await createImportJob({
        organizationId: activeMembership.organization.id,
        userId: user.id,
        entityType,
        preview,
        mapping,
      });
      setMessage(
        'Archivo preparado: ' +
          result.validRows +
          ' filas válidas y ' +
          result.invalidRows +
          ' filas con observaciones.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo preparar la importación.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-bold text-slate-950">Importar datos existentes</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Una inmobiliaria nueva puede empezar desde cero. Una inmobiliaria existente puede importar clientes o propiedades cuando lo necesite.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/templates/clientes-importacion.csv" download className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium">
            <Download className="h-4 w-4" /> Plantilla clientes
          </a>
          <a href="/templates/propiedades-importacion.csv" download className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium">
            <Download className="h-4 w-4" /> Plantilla propiedades
          </a>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            setEntityType('CONTACTS');
            setPreview(null);
            setMapping({});
            setMessage('');
          }}
          className={'rounded-xl border p-4 text-left ' + (entityType === 'CONTACTS' ? 'border-slate-900 bg-slate-50' : 'border-stone-200')}
        >
          <div className="font-semibold">Clientes y contactos</div>
          <div className="mt-1 text-sm text-slate-600">Compradores, arrendatarios, propietarios y prospectos.</div>
        </button>
        <button
          type="button"
          onClick={() => {
            setEntityType('PROPERTIES');
            setPreview(null);
            setMapping({});
            setMessage('');
          }}
          className={'rounded-xl border p-4 text-left ' + (entityType === 'PROPERTIES' ? 'border-slate-900 bg-slate-50' : 'border-stone-200')}
        >
          <div className="font-semibold">Propiedades</div>
          <div className="mt-1 text-sm text-slate-600">Inventario de inmuebles de una inmobiliaria existente.</div>
        </button>
      </div>

      <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 p-5 text-center">
        <Upload className="mb-2 h-6 w-6 text-slate-600" />
        <span className="font-semibold">Seleccionar Excel o CSV</span>
        <span className="mt-1 text-sm text-slate-500">CSV, XLSX o XLS · hasta 5.000 filas por archivo</span>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          className="sr-only"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </label>

      {preview && (
        <div className="space-y-4">
          <div className="rounded-xl border border-stone-200 p-4">
            <div className="mb-3">
              <div className="font-semibold">{preview.fileName}</div>
              <div className="text-sm text-slate-500">{preview.rows.length} filas detectadas · hoja {preview.sheetName}</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {fields.map((field) => (
                <label key={field.key}>
                  <span className="mb-1 block text-xs font-semibold">
                    {field.label}{field.required ? ' *' : ''}
                  </span>
                  <select
                    value={mapping[field.key] ?? ''}
                    onChange={(event) => setMapping((current) => ({ ...current, [field.key]: event.target.value }))}
                    className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  >
                    <option value="">No importar</option>
                    {preview.headers.map((header) => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-stone-200">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left">
                <tr>
                  {preview.headers.slice(0, 8).map((header) => (
                    <th key={header} className="whitespace-nowrap px-3 py-2 font-semibold">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 5).map((row, index) => (
                  <tr key={index} className="border-t border-stone-100">
                    {preview.headers.slice(0, 8).map((header) => (
                      <td key={header} className="max-w-48 truncate px-3 py-2">{String(row[header] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={busy || mappingErrors.length > 0 || !activeMembership}
            onClick={() => void prepareImport()}
            className="rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Validando archivo…' : 'Preparar importación'}
          </button>
        </div>
      )}

      {message && <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">{message}</div>}
    </section>
  );
}
