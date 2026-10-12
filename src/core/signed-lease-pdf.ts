/** Signed leases reuse the existing private document store without schema changes. */
export const SIGNED_LEASE_BUCKET = 'organization-documents';
export const MAX_SIGNED_LEASE_PDF_BYTES = 10 * 1024 * 1024;

/** UUID-controlled paths avoid user-defined path traversal and accidental overwrites. */
export function signedLeasePrefix(organizationId: string, leaseId: string): string {
  return organizationId + '/leases/' + leaseId + '/signed/';
}

export interface SignedLeaseDocumentRef {
  organization_id: string;
  entity_type: string;
  entity_id: string | null;
  document_type: string;
  storage_bucket: string;
  storage_path: string;
}

export function isSignedLeaseDocument(
  document: SignedLeaseDocumentRef,
  organizationId: string,
  leaseId: string,
): boolean {
  return document.organization_id === organizationId &&
    document.entity_type === 'GENERAL' &&
    document.entity_id === leaseId &&
    document.document_type === 'CONTRACT' &&
    document.storage_bucket === SIGNED_LEASE_BUCKET &&
    document.storage_path.startsWith(signedLeasePrefix(organizationId, leaseId)) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i.test(
      document.storage_path.slice(signedLeasePrefix(organizationId, leaseId).length),
    );
}

/** Client-side preflight: the private bucket enforces size and org access separately. */
export async function validateSignedLeasePdf(file: File): Promise<string | null> {
  if (!/\.pdf$/i.test(file.name) || (file.type !== 'application/pdf' && file.type !== '')) {
    return 'Selecciona un archivo PDF (.pdf).';
  }
  if (file.size < 5 || file.size > MAX_SIGNED_LEASE_PDF_BYTES) {
    return 'El PDF debe tener como máximo 10 MB y no puede estar vacío.';
  }
  try {
    const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (signature.length !== 5 || signature.some((byte, i) => byte !== [37, 80, 68, 70, 45][i])) {
      return 'El archivo seleccionado no contiene una cabecera PDF válida.';
    }
  } catch {
    return 'No se pudo leer el PDF. Vuelve a seleccionarlo.';
  }
  return null;
}
