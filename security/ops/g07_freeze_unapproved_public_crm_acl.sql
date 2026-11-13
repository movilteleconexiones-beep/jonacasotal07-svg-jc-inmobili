-- G07 emergency public CRM consent freeze. This applies ONLY to the global RPC ACL.
-- No public portal/catalog changes, no tenant records, no existing contact/lead deletion.
-- Confirm signed policies and approved hash/version before *any* restoration of this ACL.
-- Controlled ACL-only change, explicitly reversible following approval. DO NOT place in frozen migrations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='25s';

DO $preflight$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'G07 ACL freeze requires trusted migration executor';
  END IF;
  IF to_regprocedure('public.submit_public_website_lead_once(text,text,text,text,text,text,boolean,text,uuid)') IS NULL
     OR NOT has_function_privilege('anon','public.submit_public_website_lead_once(text,text,text,text,text,text,boolean,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.submit_public_website_lead_once(text,text,text,text,text,text,boolean,text,uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'G07 public lead RPC missing or already frozen; no mutation'; END IF;

  -- Candidate consignment approval schema not yet applied. When this gate exists
  -- use its independently signed policy/receipt workflow, not a blanket revoke.
  IF to_regclass('private.consignment_policy_approvals') IS NOT NULL THEN
    RAISE EXCEPTION 'G07 legal-approval registry exists: review provenance before changing permissions';
  END IF;
END $preflight$;

REVOKE EXECUTE ON FUNCTION public.submit_public_website_lead_once(text,text,text,text,text,text,boolean,text,uuid)
  FROM anon,authenticated;

DO $verify$
BEGIN
  IF has_function_privilege('anon','public.submit_public_website_lead_once(text,text,text,text,text,text,boolean,text,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.submit_public_website_lead_once(text,text,text,text,text,text,boolean,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('anon','public.tenant_public_catalog(text)','EXECUTE')
  THEN
    RAISE EXCEPTION 'G07 freeze failed, or public catalog unexpectedly lost access';
  END IF;
END $verify$;
COMMIT;
