-- 2026-10-29 INMOJCO: cover 12 missing FK lookup indexes reported by Supabase advisor.
-- Read-only preflight: verified exact FK columns and current indexes in production.
-- Small tables (<= 1 data page each). This creates only NON-UNIQUE indexes:
-- no row updates, permissions, RLS changes, constraints or subscription changes.
-- Transactional 5s lock wait: rollback instead of interfering with production writes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Consents stored outside the exposed API schema.
CREATE INDEX IF NOT EXISTS website_contact_consents_org_fk_idx
  ON private.website_contact_consents (organization_id);

-- Audit users for commission and owner payout approval.
CREATE INDEX IF NOT EXISTS commission_review_requests_archived_by_fk_idx
  ON public.commission_review_requests (archived_by);
CREATE INDEX IF NOT EXISTS invitation_roles_role_id_fk_idx
  ON public.invitation_roles (role_id);
CREATE INDEX IF NOT EXISTS license_acceptances_terms_version_fk_idx
  ON public.license_acceptances (terms_version_id);
CREATE INDEX IF NOT EXISTS maintenance_requests_reported_by_fk_idx
  ON public.maintenance_requests (reported_by);
CREATE INDEX IF NOT EXISTS organization_licenses_terms_version_fk_idx
  ON public.organization_licenses (terms_version_id);

-- Owner payment review and immutable payout ledger lookups.
CREATE INDEX IF NOT EXISTS owner_payout_review_requests_payout_fk_idx
  ON public.owner_payout_review_requests (payout_id);
CREATE INDEX IF NOT EXISTS owner_payout_review_requests_requested_by_fk_idx
  ON public.owner_payout_review_requests (requested_by);
CREATE INDEX IF NOT EXISTS owner_payout_review_requests_reviewed_by_fk_idx
  ON public.owner_payout_review_requests (reviewed_by);
CREATE INDEX IF NOT EXISTS owner_statement_payouts_recorded_by_fk_idx
  ON public.owner_statement_payouts (recorded_by);

-- Access and FK delete/restrict checks independent of tenant-first composite keys.
CREATE INDEX IF NOT EXISTS owner_statements_issued_by_fk_idx
  ON public.owner_statements (issued_by);
CREATE INDEX IF NOT EXISTS owner_statements_lease_id_fk_idx
  ON public.owner_statements (lease_id);
COMMIT;
