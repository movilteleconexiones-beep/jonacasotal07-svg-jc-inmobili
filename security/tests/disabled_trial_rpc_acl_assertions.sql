-- SQL assertions after the production-equivalent migration (twice, for idempotence).
DO $checks$
DECLARE
  rpc oid := to_regprocedure(
    'public.billing_admin_authorize_trial(uuid,uuid,uuid,integer,text)'
  )::oid;
  definition text;
BEGIN
  IF rpc IS NULL THEN
    RAISE EXCEPTION 'Disabled trial RPC unexpectedly absent';
  END IF;
  IF has_function_privilege('anon', rpc, 'EXECUTE')
     OR has_function_privilege('authenticated', rpc, 'EXECUTE') THEN
    RAISE EXCEPTION 'Obsolete free-trial RPC exposed to API callers';
  END IF;
  IF NOT has_function_privilege('service_role', rpc, 'EXECUTE') THEN
    RAISE EXCEPTION 'Trusted internal role lost execute privilege';
  END IF;
  SELECT pg_get_functiondef(rpc) INTO definition;
  IF position('Las pruebas gratuitas ya no estan disponibles.' in definition) = 0 THEN
    RAISE EXCEPTION 'Disabled trial RPC unexpectedly reactivated';
  END IF;
END
$checks$;
