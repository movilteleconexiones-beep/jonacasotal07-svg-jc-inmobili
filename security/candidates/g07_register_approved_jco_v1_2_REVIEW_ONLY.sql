-- G07 #370 / #203: REVIEW ONLY. Approved JCO agency policy v1.2 registration.
-- Execute AFTER the independently reviewed G07 registry migration, current
-- full PostgreSQL+Storage backup and isolated restore verification.
-- Does not authorize callable public RPCs, enable intake, or affect billing.
-- This is the actual approved manifest's immutable identity, NOT a new approval.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $approved_jco$
DECLARE
  v_jco uuid;
  v_pdf_url constant text := 'https://www.inmojco.com/politicas/sistema-inmobiliario-jco.pdf';
  v_pdf_sha constant text := 'ccc91413261f7ca1281d137f0cadf07ac833233120c171695ae7c79637ae0dbc';
  v_reference constant text := 'G07-JCO-V1.2-RATIFICACION-20261121';
  v_approved_at constant timestamptz := '2026-11-21T07:53:34Z';
BEGIN
  IF current_user <> 'postgres'
    OR to_regclass('private.consignment_policy_approvals') IS NULL
    OR to_regclass('private.consignment_policy_receipts') IS NULL
    OR to_regprocedure('private.consignment_policy_url_valid(text)') IS NULL
  THEN RAISE EXCEPTION 'G07: approved-policy registry baseline is absent'; END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='private.consignment_policy_approvals'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='private.consignment_policy_receipts'::regclass)
    OR has_table_privilege('anon','private.consignment_policy_approvals','SELECT')
    OR has_table_privilege('authenticated','private.consignment_policy_approvals','INSERT')
  THEN RAISE EXCEPTION 'G07: private registry RLS or grants are unsafe'; END IF;

  SELECT o.id INTO STRICT v_jco
  FROM public.organizations o WHERE o.slug='sistema-inmobiliario-jco' AND o.status='ACTIVE';

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_branding b
    WHERE b.organization_id=v_jco
      AND b.public_page_content->>'privacyPolicyUrl'=v_pdf_url)
    OR EXISTS (
      SELECT 1 FROM private.property_intake_sites s WHERE s.organization_id=v_jco AND s.enabled)
    OR EXISTS (
      SELECT 1 FROM private.consignment_policy_approvals a
      JOIN public.organizations o ON o.id=a.organization_id
      WHERE o.slug='jco-inmodigital-global')
  THEN RAISE EXCEPTION 'G07: branding mismatch, public intake open or foreign approval present'; END IF;

  INSERT INTO private.consignment_policy_approvals
    (organization_id,policy_url,policy_version,approved_document_sha256,
     approval_reference,approved_at)
  VALUES (v_jco,v_pdf_url,'1.2',v_pdf_sha,v_reference,v_approved_at)
  ON CONFLICT (organization_id) DO NOTHING;

  IF NOT EXISTS(
    SELECT 1 FROM private.consignment_policy_approvals a
    WHERE a.organization_id=v_jco AND a.policy_url=v_pdf_url
      AND a.policy_version='1.2' AND a.approved_document_sha256=v_pdf_sha
      AND a.approval_reference=v_reference AND a.approved_at=v_approved_at
      AND a.revoked_at IS NULL)
  THEN RAISE EXCEPTION 'G07: existing policy approval differs or has been revoked'; END IF;

  -- This registers the legally approved policy but does not reopen capture.
  IF EXISTS (
    SELECT 1 FROM private.property_intake_sites s WHERE s.enabled
  ) THEN RAISE EXCEPTION 'G07: intake must remain disabled'; END IF;
END $approved_jco$;
COMMIT;
