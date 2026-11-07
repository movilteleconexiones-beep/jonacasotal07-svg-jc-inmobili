-- INMOJCO no longer offers free trials. This legacy RPC always raises 42501,
-- so authenticated users must not retain EXECUTE on a disabled SECURITY DEFINER entrypoint.
-- Deliberately preserve service_role and postgres grants for internal compatibility.
REVOKE EXECUTE ON FUNCTION public.billing_admin_authorize_trial(
  uuid, uuid, uuid, integer, text
) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_admin_authorize_trial(
  uuid, uuid, uuid, integer, text
) FROM PUBLIC;