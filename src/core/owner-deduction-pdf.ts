/**
 * Private PDF evidence for individual owner statement deduction ledger entries.
 * The existing documents table restricts entity_type to GENERAL/PROPERTY/...;
 * GENERAL + entity_id + a dedicated private storage prefix links the evidence
 * without a new migration or making it visible to customer portals.
 */
export const DEDUCTION_PROOF_BUCKET = 'organization-documents';
export type DeductionProofKind = 'invoice' | 'payment';

const UUID_PDF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;

export function deductionProofPrefix(
  organizationId: string, deductionId: string, kind: DeductionProofKind,
): string {
  return organizationId + '/owner-deductions/' + deductionId + '/' + kind + '/';
}

export interface DeductionProofDocument {
  id: string;
  organization_id: string;
  entity_type: string;
  entity_id: string | null;
  document_type: string;
  storage_bucket: string;
  storage_path: string;
  title: string;
  created_at: string;
}

export function deductionProofKind(
  document: DeductionProofDocument, organizationId: string, deductionId: string,
): DeductionProofKind | null {
  if (document.organization_id !== organizationId || document.entity_type !== 'GENERAL' ||
      document.entity_id !== deductionId || document.document_type !== 'INVOICE' ||
      document.storage_bucket !== DEDUCTION_PROOF_BUCKET) return null;
  for (const kind of ['invoice', 'payment'] as const) {
    const prefix = deductionProofPrefix(organizationId, deductionId, kind);
    if (document.storage_path.startsWith(prefix) &&
        UUID_PDF.test(document.storage_path.slice(prefix.length))) return kind;
  }
  return null;
}
