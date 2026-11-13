-- G07 REVIEW ONLY: apply AFTER the separately approved consignment-policy registry
-- has been installed and approved PDF/acta evidence verified.
-- Existing historical consent receipts are immutable and retain NULL in new fields.
-- This patch is FAIL-CLOSED without a registered approval, even if a HTTPS URL exists.
-- Do not run on production while the registry migration #370 is pending.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

DO $preflight$
BEGIN
  IF current_user <> 'postgres'
    OR to_regclass('private.consignment_policy_approvals') IS NULL
    OR to_regprocedure('private.consignment_policy_url_valid(text)') IS NULL
    OR to_regclass('private.website_lead_consents') IS NULL
    OR to_regprocedure('public.submit_public_website_lead_once(text,text,text,text,text,text,boolean,text,uuid)') IS NULL
  THEN RAISE EXCEPTION 'G07 approved-policy registry and CRM consent baseline required'; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='private' AND table_name='website_lead_consents'
      AND column_name IN ('policy_version','approved_document_sha256')
  ) OR to_regprocedure('private.enforce_approved_policy_on_public_lead_receipt()') IS NOT NULL
  THEN RAISE EXCEPTION 'G07 CRM approval gate already installed; verify exact provenance'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='private.website_lead_consents'::regclass
      AND tgname='website_lead_consent_immutable' AND tgenabled='O'
  ) OR NOT (SELECT relrowsecurity FROM pg_class
    WHERE oid='private.website_lead_consents'::regclass)
    OR has_table_privilege('anon','private.website_lead_consents','INSERT')
    OR has_table_privilege('authenticated','private.website_lead_consents','INSERT')
  THEN RAISE EXCEPTION 'G07 existing immutable consent receipt or RLS protection missing'; END IF;
END $preflight$;

ALTER TABLE private.website_lead_consents
  ADD COLUMN policy_version text,
  ADD COLUMN approved_document_sha256 text;

ALTER TABLE private.website_lead_consents
  ADD CONSTRAINT website_lead_consents_policy_version_valid
    CHECK (policy_version IS NULL OR length(btrim(policy_version)) BETWEEN 1 AND 80),
  ADD CONSTRAINT website_lead_consents_approved_document_sha256_valid
    CHECK (approved_document_sha256 IS NULL OR approved_document_sha256 ~ '^[0-9a-f]{64}$');

CREATE FUNCTION private.enforce_approved_policy_on_public_lead_receipt()
 RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO ''
AS $policy_receipt$
DECLARE
  v_version text;
  v_document_sha text;
BEGIN
  -- Never trust the checkbox/link in branding as proof of legal approval.
  -- Require the approved policy to match this exact agency and submitted URL.
  IF NEW.organization_id IS NULL OR NEW.policy_url IS NULL
     OR NOT private.consignment_policy_url_valid(NEW.policy_url) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='approved_public_policy_required';
  END IF;

  SELECT a.policy_version,a.approved_document_sha256
    INTO v_version,v_document_sha
  FROM private.consignment_policy_approvals a
  WHERE a.organization_id=NEW.organization_id
    AND a.policy_url=NEW.policy_url
    AND a.revoked_at IS NULL
    AND a.approved_at<=pg_catalog.now()
    AND a.approved_document_sha256~'^[0-9a-f]{64}$'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='approved_public_policy_required';
  END IF;

  -- New receipts snapshot immutable approval metadata.
  -- Do not backfill historic rows by inference; they remain auditable as-is.
  NEW.policy_version:=v_version;
  NEW.approved_document_sha256:=v_document_sha;
  RETURN NEW;
END;
$policy_receipt$;

REVOKE ALL ON FUNCTION private.enforce_approved_policy_on_public_lead_receipt()
 FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER website_lead_consents_require_approved_policy
 BEFORE INSERT ON private.website_lead_consents
 FOR EACH ROW EXECUTE FUNCTION private.enforce_approved_policy_on_public_lead_receipt();

DO $postflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='private.website_lead_consents'::regclass
      AND tgname='website_lead_consents_require_approved_policy' AND tgenabled='O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='private.website_lead_consents'::regclass
      AND tgname='website_lead_consent_immutable' AND tgenabled='O'
  )
  OR has_function_privilege('anon',
    'private.enforce_approved_policy_on_public_lead_receipt()','EXECUTE')
  OR has_function_privilege('authenticated',
    'private.enforce_approved_policy_on_public_lead_receipt()','EXECUTE')
  THEN RAISE EXCEPTION 'G07 CRM approval trigger/immutability protections invalid'; END IF;
END $postflight$;
COMMIT;
