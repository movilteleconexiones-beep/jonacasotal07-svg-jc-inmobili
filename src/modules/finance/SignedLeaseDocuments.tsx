import { useEffect, useState, type FormEvent } from 'react';
import { FileText, Upload } from 'lucide-react';
import { useAuth } from '../../core/auth-context';
import { PERMISSIONS } from '../../core/permissions';
import {
  SIGNED_LEASE_BUCKET, isSignedLeaseDocument, signedLeasePrefix, validateSignedLeasePdf,
  type SignedLeaseDocumentRef,
} from '../../core/signed-lease-pdf';
import { supabase } from '../../lib/supabase';

interface LeaseOption { id: string; contract_number: string | null; status: string }
interface SignedDocument extends SignedLeaseDocumentRef {
  id: string;
  title: string;
  created_at: string;
  size_bytes: number | null;
}
const fieldClass = 'mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2';

/** Lease PDFs remain private, separate from the rental ledger and payment status. */
export function SignedLeaseDocuments({
  organizationId, leases, preferredLeaseId, onUploaded,
}: { organizationId: string; leases: LeaseOption[]; preferredLeaseId?: string; onUploaded?: (leaseId:string)=>void }) {
  const { can, user } = useAuth();
  const mayRead = can(PERMISSIONS.LEASES_VIEW) && can(PERMISSIONS.DOCUMENTS_VIEW);
  const mayUpload = mayRead && can(PERMISSIONS.DOCUMENTS_UPLOAD);
  const [leaseId, setLeaseId] = useState(preferredLeaseId??'');
  const [documents, setDocuments] = useState<SignedDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!leases.some(lease => lease.id === leaseId)) setLeaseId('');
  }, [leaseId, leases]);

  useEffect(() => {
    let cancelled = false;
    setDocuments([]);
    if (!mayRead || !organizationId || !leases.length) {
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase.from('documents')
          .select('id,organization_id,entity_type,entity_id,document_type,storage_bucket,storage_path,title,created_at,size_bytes')
          .eq('organization_id', organizationId)
          .eq('entity_type', 'GENERAL')
          .eq('document_type', 'CONTRACT')
          .eq('storage_bucket', SIGNED_LEASE_BUCKET)
          .like('storage_path', organizationId + '/leases/%/signed/%')
          .order('created_at', { ascending: false }).limit(501);
        if (cancelled) return;
        if (error || (data?.length ?? 0) > 500) {
          setMessage('No se pudo consultar el archivo completo de contratos firmados. Comprueba tus permisos.');
          return;
        }
        const permitted = (data ?? []).filter(row =>
          leases.some(lease => isSignedLeaseDocument(row, organizationId, lease.id)));
        setDocuments(permitted as SignedDocument[]);
      } catch {
        if (!cancelled) setMessage('Error de conexión al consultar contratos firmados.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [organizationId, leases, mayRead, revision]);

  async function uploadSignedPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mayUpload || uploading || !organizationId || !user) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const selectedLeaseId = String(form.get('lease_id') ?? '');
    const lease = leases.find(item => item.id === selectedLeaseId && item.status !== 'CANCELLED');
    const input = formElement.elements.namedItem('file') as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!lease || form.get('signed_confirmation') !== 'on' || !file) {
      setMessage('Selecciona un contrato existente, su PDF y confirma que ya fue firmado por las partes.');
      return;
    }
    setUploading(true);
    setMessage('');
    try {
      const errorMessage = await validateSignedLeasePdf(file);
      if (errorMessage) { setMessage(errorMessage); return; }

      // No user-controlled filenames in the private object key.
      const path = signedLeasePrefix(organizationId, lease.id) + crypto.randomUUID() + '.pdf';
      const { error: storageError } = await supabase.storage.from(SIGNED_LEASE_BUCKET)
        .upload(path, file, { upsert: false, contentType: 'application/pdf', cacheControl: '0' });
      if (storageError) { setMessage('No se pudo subir el PDF: ' + storageError.message); return; }

      // GENERAL is the existing permitted entity_type; entity_id and the dedicated
      // lease path link the document without an unsafe production schema migration.
      const { error: documentError } = await supabase.from('documents').insert({
        organization_id: organizationId,
        entity_type: 'GENERAL',
        entity_id: lease.id,
        document_type: 'CONTRACT',
        title: 'Contrato firmado · ' + (lease.contract_number || lease.id.slice(0, 8)),
        storage_bucket: SIGNED_LEASE_BUCKET,
        storage_path: path,
        mime_type: 'application/pdf',
        size_bytes: file.size,
        notes: 'PDF firmado por las partes. Archivo privado; no constituye validación criptográfica de firmas.',
        uploaded_by: user.id,
      });
      if (documentError) {
        // The storage policy may deny removal to users without documents.delete.
        const { error: cleanupError } = await supabase.storage.from(SIGNED_LEASE_BUCKET).remove([path]);
        setMessage('No se pudo vincular el PDF al contrato: ' + documentError.message +
          (cleanupError ? ' Contacta al administrador para revisar el archivo privado pendiente.' : ''));
        return;
      }
      formElement.reset();
      setLeaseId(lease.id);
      setMessage('Contrato firmado guardado de forma privada y asociado al arrendamiento.');
      setRevision(value => value + 1);
      onUploaded?.(lease.id);
    } catch {
      // A timeout may occur after server persistence: never claim an upload failed
      // definitively or delete a possibly committed document.
      setMessage('No se confirmó la carga. Consulta la lista antes de intentarlo nuevamente.');
      setRevision(value => value + 1);
    } finally {
      setUploading(false);
    }
  }

  async function viewSignedPdf(document: SignedDocument) {
    if (!mayRead || !leases.some(lease => isSignedLeaseDocument(document, organizationId, lease.id))) return;
    setMessage('');
    try {
      const { data, error } = await supabase.storage.from(SIGNED_LEASE_BUCKET)
        .createSignedUrl(document.storage_path, 60);
      if (error || !data?.signedUrl) {
        setMessage('No fue posible abrir el PDF. Revisa permisos de documentos.');
        return;
      }
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setMessage('Error de conexión al generar el enlace temporal del PDF.');
    }
  }

  const available = leases.filter(lease => lease.status !== 'CANCELLED');
  const selectedDocuments = documents.filter(document => document.entity_id === leaseId);
  return <div className="space-y-4">
    <div>
      <h3 className="font-semibold">Adjuntar contrato firmado en PDF</h3>
      <p className="mt-1 text-sm text-slate-600">
        Selecciona un contrato creado previamente. El archivo es privado, se conserva sin sobrescribir
        versiones anteriores y no activa contratos ni registra cobros.
      </p>
    </div>
    {!mayRead && <p role="alert" className="text-sm text-amber-800">
      Para consultar contratos firmados necesitas permisos de arrendamientos y documentos.
    </p>}
    {mayRead && <form onSubmit={event => void uploadSignedPdf(event)}
      className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 md:grid-cols-2">
      <label className="text-sm">Contrato de arrendamiento
        <select className={fieldClass} required name="lease_id" value={leaseId}
          onChange={event => setLeaseId(event.target.value)}>
          <option value="">Seleccionar contrato</option>
          {available.map(lease => <option key={lease.id} value={lease.id}>
            {lease.contract_number || lease.id.slice(0, 8)} · {lease.status}
          </option>)}
        </select>
      </label>
      <label className="text-sm">Archivo firmado (PDF, máximo 10 MB)
        <input type="file" name="file" accept=".pdf,application/pdf" required className={fieldClass}
          disabled={!mayUpload || uploading} />
      </label>
      <label className="flex items-start gap-2 text-sm md:col-span-2">
        <input type="checkbox" name="signed_confirmation" required className="mt-1"
          disabled={!mayUpload || uploading} />
        Confirmo que el documento que adjunto ya fue firmado por las partes.
      </label>
      {!available.length && <p className="text-sm text-amber-800 md:col-span-2">
        Primero crea un contrato en «Nuevo contrato»; después podrás adjuntar su PDF firmado.
      </p>}
      {!mayUpload && <p className="text-sm text-amber-800 md:col-span-2">
        Tu perfil requiere permiso para cargar documentos antes de poder adjuntar el contrato.
      </p>}
      <button type="submit" disabled={!mayUpload || uploading || !leaseId}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
        <Upload className="h-4 w-4" />{uploading ? 'Subiendo contrato…' : 'Subir contrato firmado (PDF)'}
      </button>
    </form>}
    {mayRead && <div className="space-y-2">
      <p className="text-sm font-semibold">Contratos firmados guardados {leaseId ? 'para este arrendamiento' : ''}</p>
      {loading ? <p className="text-sm text-slate-500">Consultando archivos privados…</p> :
        !leaseId ? <p className="text-sm text-slate-500">Selecciona un contrato para consultar sus PDF.</p> :
        selectedDocuments.length === 0 ? <p className="text-sm text-slate-500">
          Este contrato todavía no tiene un PDF firmado adjunto.
        </p> : selectedDocuments.map(document => <div key={document.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <FileText className="h-4 w-4 shrink-0" />
            <span>{document.title} · {new Date(document.created_at).toLocaleDateString('es-CO')}</span>
          </div>
          <button type="button" className="rounded-lg border px-3 py-1.5 text-sm font-semibold"
            onClick={() => void viewSignedPdf(document)}>Ver PDF</button>
        </div>)}
    </div>}
    {message && <p role="status" className="text-sm text-amber-800">{message}</p>}
    <p className="text-xs text-slate-500">
      Se almacena una copia del documento. INMOJCO no verifica la autenticidad de las firmas
      digitales o manuscritas mediante esta carga.
    </p>
  </div>;
}
