-- G07 #370: production candidate for the personal SuperAdmin estate agency only.
-- REVIEW ONLY: must NOT execute before exact public PDF SHA/HTTPS verified,
-- the G07 consignment private registry migration and CRM receipt guard are
-- installed, and CURRENT full Postgres + Storage backup is restore-verified.
-- Never run the obsolete external-agency candidate from PR #423.
-- This registers the *previously* approved policy, not a new legal signature.
-- RUT, signature images and acta bytes MUST remain outside public GitHub.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $g07_personal$
DECLARE
  v_own constant uuid := '97c570d3-200d-4ae7-af96-f22f69563e29';
  v_external constant uuid := '976cd8d8-d66c-4aeb-9784-4b4d10250918';
  v_url constant text := 'https://www.inmojco.com/politicas/jco-inmodigital-global.pdf';
  v_policy_sha constant text := 'df30b71f6c564e9b06f26847d1fe450fce3fcfca0b6305420e719b9c5ffbf384';
  v_acta_sha constant text := 'e4365af30f9e56696ffe5a6dcb53def876a8523ee0046826e1feb5ed4f3ff810';
  v_ref constant text := 'G07-INMODIGITAL-ADOPCION-20261122';
  v_approved_at constant timestamptz := '2026-11-23T03:05:43Z';
  n int;
BEGIN
  IF current_user <> 'postgres'
    OR to_regclass('private.consignment_policy_approvals') IS NULL
    OR to_regclass('private.consignment_policy_receipts') IS NULL
    OR to_regprocedure('private.enforce_approved_policy_on_public_lead_receipt()') IS NULL
    OR to_regprocedure('private.consignment_policy_url_valid(text)') IS NULL
    OR NOT private.consignment_policy_url_valid(v_url)
  THEN RAISE EXCEPTION 'G07 personal: private approval and CRM guard migrations must be applied FIRST'; END IF;

  IF v_policy_sha !~ '^[0-9a-f]{64}$' OR v_acta_sha !~ '^[0-9a-f]{64}$'
    OR v_policy_sha=v_acta_sha
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='private.consignment_policy_approvals'::regclass)
    OR has_table_privilege('anon','private.consignment_policy_approvals','SELECT')
    OR has_table_privilege('authenticated','private.consignment_policy_approvals','INSERT')
  THEN RAISE EXCEPTION 'G07 personal: SHA or private registry RLS/ACL mismatch'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations o
    JOIN public.organization_members m ON m.organization_id=o.id AND m.status='ACTIVE'
    JOIN public.platform_admins pa ON pa.user_id=m.user_id
      AND pa.active AND pa.admin_level='SUPER_ADMIN'
    WHERE o.id=v_own AND o.slug='jco-inmodigital-global' AND o.status='ACTIVE'
  ) OR EXISTS (
    SELECT 1 FROM public.platform_admins pa
    JOIN public.organization_members m ON m.user_id=pa.user_id AND m.status='ACTIVE'
    WHERE m.organization_id=v_external AND pa.active AND pa.admin_level='SUPER_ADMIN'
  ) THEN RAISE EXCEPTION 'G07 personal: tenant identity/SuperAdmin isolation mismatch'; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.subscriptions s JOIN public.organization_licenses l
    ON l.organization_id=s.organization_id
    WHERE s.organization_id=v_own AND s.status='LIFETIME' AND s.billing_mode='LIFETIME'
      AND s.current_period_end IS NULL AND l.status='ACTIVE'
      AND l.license_type='LIFETIME' AND l.ends_at IS NULL
  ) THEN RAISE EXCEPTION 'G07 personal: lifetime access must be intact'; END IF;

  IF EXISTS(SELECT 1 FROM private.property_intake_sites s WHERE s.organization_id IN(v_own,v_external) AND s.enabled)
    OR EXISTS(SELECT 1 FROM private.consignment_policy_approvals a WHERE a.organization_id=v_external)
  THEN RAISE EXCEPTION 'G07 personal: both public intakes must remain closed; external remains unapproved'; END IF;

  UPDATE public.organization_branding b
     SET public_page_content=pg_catalog.jsonb_set(b.public_page_content, '{privacyPolicyUrl}', pg_catalog.to_jsonb(v_url), true)
   WHERE b.organization_id=v_own
     AND pg_catalog.jsonb_typeof(b.public_page_content)='object'
     AND (b.public_page_content->>'privacyPolicyUrl' IS NULL OR b.public_page_content->>'privacyPolicyUrl'=v_url);
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'G07 personal: branding missing or foreign legal link exists'; END IF;

  INSERT INTO private.consignment_policy_approvals
    (organization_id,policy_url,policy_version,approved_document_sha256,approval_reference,approved_at)
  VALUES(v_own,v_url,'1.0',v_policy_sha,v_ref,v_approved_at)
  ON CONFLICT (organization_id) DO NOTHING;

  IF NOT EXISTS(SELECT 1 FROM private.consignment_policy_approvals a
    WHERE a.organization_id=v_own AND a.policy_url=v_url AND a.policy_version='1.0'
      AND a.approved_document_sha256=v_policy_sha AND a.approval_reference=v_ref
      AND a.approved_at=v_approved_at AND a.revoked_at IS NULL)
  THEN RAISE EXCEPTION 'G07 personal: existing approval differs or was revoked'; END IF;

  IF EXISTS (SELECT 1 FROM private.property_intake_sites WHERE enabled)
    OR EXISTS (SELECT 1 FROM private.consignment_policy_approvals WHERE organization_id=v_external)
  THEN RAISE EXCEPTION 'G07 personal: no public intake or external adoption permitted'; END IF;
END $g07_personal$;
COMMIT;
