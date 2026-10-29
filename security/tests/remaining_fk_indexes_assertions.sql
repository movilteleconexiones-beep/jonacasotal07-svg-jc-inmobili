-- Ensure every index survived reapplying the migration, is valid, and is non-unique.
DO $verify$
DECLARE idxname text;
DECLARE verified_count integer := 0;
BEGIN
  FOREACH idxname IN ARRAY ARRAY[
    'private.website_contact_consents_org_fk_idx',
    'public.commission_review_requests_archived_by_fk_idx',
    'public.invitation_roles_role_id_fk_idx',
    'public.license_acceptances_terms_version_fk_idx',
    'public.maintenance_requests_reported_by_fk_idx',
    'public.organization_licenses_terms_version_fk_idx',
    'public.owner_payout_review_requests_payout_fk_idx',
    'public.owner_payout_review_requests_requested_by_fk_idx',
    'public.owner_payout_review_requests_reviewed_by_fk_idx',
    'public.owner_statement_payouts_recorded_by_fk_idx',
    'public.owner_statements_issued_by_fk_idx',
    'public.owner_statements_lease_id_fk_idx'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_index ix ON ix.indexrelid=c.oid
      WHERE c.oid=to_regclass(idxname) AND ix.indisvalid
        AND ix.indisready AND NOT ix.indisunique
    ) THEN RAISE EXCEPTION 'Index not valid/non-unique: %',idxname; END IF;
    verified_count := verified_count + 1;
  END LOOP;
  IF verified_count<>12 THEN RAISE EXCEPTION 'Unexpected index coverage count'; END IF;
  IF (SELECT count(*) FROM public.owner_statements)<>1 THEN
    RAISE EXCEPTION 'Index migration unexpectedly modified statement data';
  END IF;
END;
$verify$;
