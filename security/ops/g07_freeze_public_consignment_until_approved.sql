-- G07/#370 - Public intake ACL freeze before signed, verified privacy policies.
-- Do not run supabase db push (#104). Deploy this exact ACL change only,
-- after a reversible clone rehearsal and successful CI.
-- This freeze does not register any acceptance or legal approval.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '25s';

DO $preflight$
DECLARE
  v_has_approvals boolean := false;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'G07 requires trusted migration executor' USING ERRCODE = '42501';
  END IF;
  IF to_regprocedure('public.get_public_property_intake_site(text)') IS NULL
     OR to_regprocedure('public.submit_property_consignment(text,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.tenant_public_catalog(text)') IS NULL THEN
    RAISE EXCEPTION 'Required RPC missing' USING ERRCODE = 'P0002';
  END IF;
  IF to_regclass('private.consignment_policy_approvals') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM private.consignment_policy_approvals WHERE revoked_at IS NULL)'
      INTO v_has_approvals;
  END IF;
  IF v_has_approvals THEN
    RAISE EXCEPTION 'Approved policies found: use reviewed G07 gate instead of blanket freeze';
  END IF;
  IF NOT has_function_privilege('anon','public.submit_property_consignment(text,uuid,jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.submit_property_consignment(text,uuid,jsonb)','EXECUTE')
     OR NOT has_function_privilege('anon','public.get_public_property_intake_site(text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.get_public_property_intake_site(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected intake ACL: abort without mutation';
  END IF;
  IF NOT has_function_privilege('anon','public.tenant_public_catalog(text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.submit_property_consignment(text,uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Protected public catalog or service permission missing';
  END IF;
END;
$preflight$;

-- Both metadata and submission are frozen, so a later accidental flip of
-- private.property_intake_sites.enabled cannot show a form or accept PII.
REVOKE EXECUTE ON FUNCTION public.get_public_property_intake_site(text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_property_consignment(text,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;

DO $postflight$
BEGIN
  IF has_function_privilege('anon','public.get_public_property_intake_site(text)','EXECUTE')
    OR has_function_privilege('authenticated','public.get_public_property_intake_site(text)','EXECUTE')
    OR has_function_privilege('anon','public.submit_property_consignment(text,uuid,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.submit_property_consignment(text,uuid,jsonb)','EXECUTE')
    OR NOT has_function_privilege('anon','public.tenant_public_catalog(text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.submit_property_consignment(text,uuid,jsonb)','EXECUTE')
  THEN
    RAISE EXCEPTION 'G07 postflight failed: transaction rolled back';
  END IF;
END;
$postflight$;

COMMIT;
