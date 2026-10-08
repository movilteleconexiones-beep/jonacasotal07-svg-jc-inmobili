-- JCO emergency registration lockdown — REVIEW ONLY, NOT APPLIED.
-- Goal: prevent ordinary authenticated users from calling the existing
-- SECURITY DEFINER create_organization_with_owner functions directly.
-- IMPORTANT: blocks self-service organization creation for EVERY user,
-- including platform owners, until a separately authorized admin workflow exists.
-- Execute only after explicit production approval and operational review.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.create_organization_with_owner(text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_organization_with_owner(text,text,text) FROM PUBLIC, anon, authenticated;
-- Existing grants to any other custom roles must be reviewed before rollout.
COMMIT;

-- Validation after rollout (read-only):
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS signature,
--        has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_can_execute,
--        has_function_privilege('anon',p.oid,'EXECUTE') AS anon_can_execute
-- FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
-- WHERE n.nspname='public' AND p.proname='create_organization_with_owner';

-- Future provisioning: a trusted backend service with server-side platform_admins
-- authorization, auditing, and contract approval. Never ship service_role to Vite.
