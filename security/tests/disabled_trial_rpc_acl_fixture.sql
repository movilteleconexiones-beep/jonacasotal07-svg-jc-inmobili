-- Independent PostgreSQL fixture. No production data, subscriptions or payments.
DO $setup$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$setup$;

CREATE OR REPLACE FUNCTION public.billing_admin_authorize_trial(
  target_org uuid, target_owner uuid, target_plan uuid,
  trial_days integer, reason text
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $body$
BEGIN
  RAISE EXCEPTION 'Las pruebas gratuitas ya no estan disponibles.'
    USING ERRCODE = '42501';
END
$body$;

REVOKE ALL ON FUNCTION public.billing_admin_authorize_trial(
  uuid, uuid, uuid, integer, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_admin_authorize_trial(
  uuid, uuid, uuid, integer, text
) TO authenticated, service_role;
