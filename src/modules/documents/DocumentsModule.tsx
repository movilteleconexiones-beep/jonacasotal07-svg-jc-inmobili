import { useEffect, useState, type FormEvent } from 'react';
import { Download, FileText, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import { supabase } from '../../lib/supabase';

interface DocumentRow {
  id: string;
  title: string;
  document_type: string;
  entity_type: string;
  entity_id: string | null;
  storage_bucket: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
}

export function DocumentsModule() {
  const { user, activeMembership, can } = useAuth();
  const organizationId = activeMembership?.organization.id;

  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);

  async function load() {
    if (!organizationId) return;
    const { data, error } = await supabase
      .from('documents')
      .select('id,title,document_type,entity_type,entity_id,storage_bucket,storage_path,mime_type,size_bytes,expires_at,notes,created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) setMessage(error.message);
    else setRows((data ?? []) as DocumentRow[]);
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !user) return;

    const form = new FormData(event.currentTarget);
    const input = event.currentTarget.elements.namedItem('file') as HTMLInputElement | null;
    const file = input?.files?.[0];

    if (!file) {
      setMessage('Selecciona un archivo.');
      return;
    }

    setUploading(true);
    setMessage('');

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const path = organizationId + '/' + new Date().getFullYear() + '/' + Date.now() + '-' + safeName;

    const { error: uploadError } = await supabase.storage
      .from('organization-documents')
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || undefined,
      });

    if (uploadError) {
      setMessage(uploadError.message);
      setUploading(false);
      return;
    }

    const { error: dbError } = await supabase.from('documents').insert({
      organization_id: organizationId,
      entity_type: String(form.get('entity_type') ?? 'GENERAL'),
      entity_id: String(form.get('entity_id') ?? '').trim() || null,
      document_type: String(form.get('document_type') ?? 'OTHER'),
      title: String(form.get('title') ?? file.name).trim() || file.name,
      storage_bucket: 'organization-documents',
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      expires_at: String(form.get('expires_at') ?? '').trim() || null,
      notes: String(form.get('notes') ?? '').trim() || null,
      uploaded_by: user.id,
    });

    if (dbError) {
      await supabase.storage.from('organization-documents').remove([path]);
      setMessage(dbError.message);
      setUploading(false);
      return;
    }

    setMessage('Documento cargado correctamente.');
    event.currentTarget.reset();
    setUploading(false);
    await load();
  }

  async function openDocument(row: DocumentRow) {
    const { data, error } = await supabase.storage
      .from(row.storage_bucket)
      .createSignedUrl(row.storage_path, 60);

    if (error) {
      setMessage(error.message);
      return;
    }

    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function deleteDocument(row: DocumentRow) {
    if (!can(PERMISSIONS.DOCUMENTS_DELETE)) return;

    const { error: storageError } = await supabase.storage
      .from(row.storage_bucket)
      .remove([row.storage_path]);

    if (storageError) {
      setMessage(storageError.message);
      return;
    }

    const { error } = await supabase.from('documents').delete().eq('id', row.id);
    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Documento eliminado.');
    await load();
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Documentos</h1>
        <p className="mt-1 text-sm text-slate-600">
          Archivos privados de la inmobiliaria con acceso protegido por permisos.
        </p>
      </div>

      {can(PERMISSIONS.DOCUMENTS_UPLOAD) && (
        <form onSubmit={uploadDocument} className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:grid-cols-2">
          <Field name="title" label="Título del documento" />
          <label>
            <span className="mb-1 block text-sm font-medium">Tipo</span>
            <select name="document_type" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="OTHER">Otro</option>
              <option value="CONTRACT">Contrato</option>
              <option value="ID">Identificación</option>
              <option value="CERTIFICATE">Certificado</option>
              <option value="PROPERTY_TITLE">Título / escritura</option>
              <option value="OFFER">Oferta</option>
              <option value="INVOICE">Factura / soporte</option>
            </select>
          </label>

          <label>
            <span className="mb-1 block text-sm font-medium">Relacionado con</span>
            <select name="entity_type" className="w-full rounded-xl border border-stone-300 px-3 py-2.5">
              <option value="GENERAL">General</option>
              <option value="PROPERTY">Propiedad</option>
              <option value="OWNER">Propietario</option>
              <option value="CONTACT">Cliente / contacto</option>
              <option value="LEAD">Lead</option>
              <option value="DEAL">Negocio</option>
              <option value="USER">Usuario</option>
            </select>
          </label>

          <Field name="entity_id" label="ID relacionado (opcional)" />
          <Field name="expires_at" label="Vence el" type="date" />

          <label>
            <span className="mb-1 block text-sm font-medium">Archivo *</span>
            <input
              name="file"
              type="file"
              required
              className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2"
            />
          </label>

          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium">Notas</span>
            <textarea name="notes" rows={3} className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
          </label>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {uploading ? 'Subiendo…' : 'Subir documento'}
            </button>
          </div>
        </form>
      )}

      {message && <div className="rounded-xl border border-stone-200 bg-white p-3 text-sm">{message}</div>}

      <div className="rounded-2xl border border-stone-200 bg-white">
        <div className="divide-y divide-stone-100">
          {rows.map((row) => (
            <article key={row.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-slate-500" />
                  <div className="truncate font-semibold">{row.title}</div>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {row.document_type} · {row.entity_type}
                  {row.expires_at ? ' · vence ' + row.expires_at : ''}
                </div>
                {row.size_bytes != null && (
                  <div className="mt-1 text-[11px] text-slate-400">
                    {(row.size_bytes / 1024 / 1024).toFixed(2)} MB
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void openDocument(row)}
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold"
                >
                  <Download className="h-3.5 w-3.5" />
                  Abrir
                </button>

                {can(PERMISSIONS.DOCUMENTS_DELETE) && (
                  <button
                    type="button"
                    onClick={() => void deleteDocument(row)}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Eliminar
                  </button>
                )}
              </div>
            </article>
          ))}

          {rows.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              No hay documentos cargados.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...inputProps } = props;
  return (
    <label>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input {...inputProps} className="w-full rounded-xl border border-stone-300 px-3 py-2.5" />
    </label>
  );
}
