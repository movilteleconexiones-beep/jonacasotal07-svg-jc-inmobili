import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FileText, Paperclip, Upload } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { validateSignedLeasePdf } from '../../core/signed-lease-pdf';
import {
  DEDUCTION_PROOF_BUCKET, deductionProofKind, deductionProofPrefix,
  type DeductionProofDocument, type DeductionProofKind,
} from '../../core/owner-deduction-pdf';

const LABELS: Record<DeductionProofKind, string> = {
  invoice: 'Factura o recibo del servicio',
  payment: 'Comprobante de pago',
};

export interface DeductionEvidenceFile {
  kind: DeductionProofKind;
  file: File;
}

/**
 * Upload evidence after the draft deduction exists. Uploads are append-only:
 * never change the amount, responsible party, ledger approval or bank status.
 * Errors must not cause a second deduction to be inserted.
 */
export async function uploadDeductionEvidence(args: {
  organizationId: string;
  deductionId: string;
  userId: string;
  category: string;
  kind: DeductionProofKind;
  file: File;
  // UUID retained for exact retries of a previously uncertain upload.
  uploadId?: string;
}): Promise<string | null> {
  const validation = await validateSignedLeasePdf(args.file);
  if (validation) return validation;

  if (args.uploadId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(args.uploadId))
    return 'Identificador de carga inválido. No se guardó ningún documento.';
  const path = deductionProofPrefix(args.organizationId, args.deductionId, args.kind)
    + (args.uploadId ?? crypto.randomUUID()) + '.pdf';
  try {
    const { error: uploadError } = await supabase.storage.from(DEDUCTION_PROOF_BUCKET)
      .upload(path, args.file, {
        upsert: false,
        contentType: 'application/pdf',
        cacheControl: '0',
      });
    if (uploadError) return 'No se pudo confirmar la carga de ' + LABELS[args.kind] + ': ' + uploadError.message +
      '. Si el archivo ya existe, consulta los soportes antes de intentar una nueva carga.';

    const { error: metadataError } = await supabase.from('documents').insert({
      organization_id: args.organizationId,
      entity_type: 'GENERAL',
      entity_id: args.deductionId,
      document_type: 'INVOICE',
      title: LABELS[args.kind] + ' · ' + args.category,
      storage_bucket: DEDUCTION_PROOF_BUCKET,
      storage_path: path,
      mime_type: 'application/pdf',
      size_bytes: args.file.size,
      notes: 'Soporte adjunto a una deducción. No certifica que se haya realizado un pago bancario.',
      uploaded_by: args.userId,
    });
    if (metadataError) {
      const { error: cleanupError } = await supabase.storage.from(DEDUCTION_PROOF_BUCKET)
        .remove([path]);
      return 'No se pudo vincular ' + LABELS[args.kind] + ': ' + metadataError.message +
        (cleanupError ? '. Revisa con el administrador el archivo privado pendiente.' : '');
    }
    return null;
  } catch {
    // An interrupted response can occur after persistence; don't delete or
    // incorrectly tell the user that no document was stored.
    return 'No se pudo confirmar ' + LABELS[args.kind] + '. Revisa los PDFs antes de volver a subirlo.';
  }
}

export function OwnerDeductionEvidence({
  organizationId, deductionId, category, userId, canRead, canUpload,
}: {
  organizationId: string;
  deductionId: string;
  category: string;
  userId: string | undefined;
  canRead: boolean;
  canUpload: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [documents, setDocuments] = useState<DeductionProofDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // React state updates do not synchronously block a second submit event.
  const uploadInFlight = useRef(false);
  // Preserve UUIDs for an identical selection if Storage/metadata returned an
  // uncertain result: upsert:false then blocks a second physical PDF object.
  const pendingUpload = useRef<{
    fingerprint: string;
    ids: Partial<Record<DeductionProofKind,string>>;
    confirmed: Partial<Record<DeductionProofKind,true>>;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDocuments([]);
    if (!expanded || !canRead) {
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await supabase.from('documents')
          .select('id,organization_id,entity_type,entity_id,document_type,storage_bucket,storage_path,title,created_at')
          .eq('organization_id', organizationId)
          .eq('entity_type', 'GENERAL')
          .eq('entity_id', deductionId)
          .eq('document_type', 'INVOICE')
          .eq('storage_bucket', DEDUCTION_PROOF_BUCKET)
          .order('created_at', { ascending: false }).limit(101);
        if (cancelled) return;
        if (error || (data?.length ?? 0) > 100) {
          setMessage('No se pudo consultar toda la documentación de este gasto.');
          return;
        }
        setDocuments((data ?? []).filter(row =>
          deductionProofKind(row, organizationId, deductionId)) as DeductionProofDocument[]);
      } catch {
        if (!cancelled) setMessage('Falló la consulta de soportes. Reintenta abrirlos.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [organizationId, deductionId, canRead, expanded, revision]);

  async function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canUpload || !userId || busy || uploadInFlight.current) return;
    const form = event.currentTarget;
    const invoice = (form.elements.namedItem('invoice_pdf') as HTMLInputElement | null)?.files?.[0];
    const payment = (form.elements.namedItem('payment_pdf') as HTMLInputElement | null)?.files?.[0];
    const selected: DeductionEvidenceFile[] = [];
    if (invoice) selected.push({ kind: 'invoice', file: invoice });
    if (payment) selected.push({ kind: 'payment', file: payment });
    if (!selected.length) { setMessage('Selecciona una factura o un comprobante de pago en PDF.'); return; }

    uploadInFlight.current = true;
    const fingerprint = JSON.stringify([organizationId, deductionId, category, userId,
      ...selected.map(({kind,file}) => [kind,file.name,file.size,file.lastModified,file.type])]);
    if (pendingUpload.current?.fingerprint !== fingerprint)
      pendingUpload.current = {fingerprint, ids:{}, confirmed:{}};
    const attempt = pendingUpload.current;
    setBusy(true);
    setMessage('');
    try {
      for (const item of selected) {
        const invalid = await validateSignedLeasePdf(item.file);
        if (invalid) { setMessage(LABELS[item.kind] + ': ' + invalid); return; }
      }
      const failures: string[] = [];
      for (const item of selected) {
        // On a partial success, do not try to upload an already-linked PDF again.
        if (attempt.confirmed[item.kind]) continue;
        const uploadId = attempt.ids[item.kind] ?? crypto.randomUUID();
        attempt.ids[item.kind] = uploadId;
        const error = await uploadDeductionEvidence({
          organizationId, deductionId, category, userId,
          kind: item.kind, file: item.file, uploadId,
        });
        if (error) failures.push(error);
        else attempt.confirmed[item.kind] = true;
      }
      if (failures.length) setMessage(failures.join(' ') +
        ' Si algún archivo ya figura en la lista, no vuelvas a subirlo.');
      else {
        pendingUpload.current = null;
        form.reset();
        setMessage('PDF guardados como soportes privados de esta deducción.');
      }
      setRevision(previous => previous + 1);
    } catch {
      setMessage('No se confirmó el resultado de la carga. Revisa los archivos antes de reintentar.');
      setRevision(previous => previous + 1);
    } finally {
      uploadInFlight.current = false;
      setBusy(false);
    }
  }

  async function openEvidence(document: DeductionProofDocument) {
    if (!canRead || !deductionProofKind(document, organizationId, deductionId)) return;
    try {
      const { data, error } = await supabase.storage.from(DEDUCTION_PROOF_BUCKET)
        .createSignedUrl(document.storage_path, 60);
      if (error || !data?.signedUrl) {
        setMessage('No fue posible abrir el soporte. Revisa tus permisos de documentos.');
        return;
      }
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setMessage('No se pudo generar el enlace privado del PDF.');
    }
  }

  if (!canRead) return <span className="text-xs text-slate-500">Sin permiso de documentos</span>;
  return <div className="space-y-2">
    <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold underline"
      aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <Paperclip className="h-3.5 w-3.5" />
      {expanded ? 'Ocultar soportes' : 'Adjuntar / ver PDFs'}
    </button>
    {expanded && <div className="min-w-64 max-w-sm space-y-2 rounded-lg border bg-white p-3">
      {loading ? <p className="text-xs text-slate-500">Consultando soportes…</p> :
        documents.length ? documents.map(document => <button key={document.id} type="button"
          onClick={() => void openEvidence(document)}
          className="flex items-center gap-2 text-left text-xs font-semibold text-slate-800 underline">
          <FileText className="h-3.5 w-3.5 shrink-0" />
          {LABELS[deductionProofKind(document, organizationId, deductionId)!]}
          {' · '}{new Date(document.created_at).toLocaleDateString('es-CO')}
        </button>) : <p className="text-xs text-slate-500">Todavía no hay PDFs adjuntos.</p>}
      {canUpload && <form onSubmit={event => void submitEvidence(event)} className="space-y-2">
        <label className="block text-xs">Factura / recibo (PDF, máximo 10 MB)
          <input name="invoice_pdf" type="file" accept=".pdf,application/pdf"
            disabled={busy} className="mt-1 block w-full text-xs" />
        </label>
        <label className="block text-xs">Comprobante de pago (PDF, máximo 10 MB)
          <input name="payment_pdf" type="file" accept=".pdf,application/pdf"
            disabled={busy} className="mt-1 block w-full text-xs" />
        </label>
        <button type="submit" disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-semibold disabled:opacity-50">
          <Upload className="h-3.5 w-3.5" /> {busy ? 'Subiendo…' : 'Guardar PDF de soporte'}
        </button>
      </form>}
      {message && <p role="status" className="text-xs text-amber-800">{message}</p>}
      <p className="text-[11px] text-slate-500">
        Los PDFs son privados. Adjuntar un soporte no certifica su pago ni modifica la liquidación.
      </p>
    </div>}
  </div>;
}
