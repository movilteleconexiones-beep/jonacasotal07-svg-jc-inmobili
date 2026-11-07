-- Mirrors migration already applied to production Supabase on 2026-10-29.
-- Free-trial authorization is permanently disabled. The RPC body raises 42501;
-- leave service_role available to trusted internal consumers, but close its
-- unnecessary authenticated entrypoint. Reapplying this ACL is idempotent.
REVOKE EXECUTE ON FUNCTION public.billing_admin_authorize_trial(
  uuid, uuid, uuid, integer, text
) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_admin_authorize_trial(
  uuid, uuid, uuid, integer, text
) FROM PUBLIC;
