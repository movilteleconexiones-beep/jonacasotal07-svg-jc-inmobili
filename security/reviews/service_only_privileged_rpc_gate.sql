-- INMOJCO: verify that money, subscriptions, internal guards and Storage
-- resolution RPCs remain callable ONLY by trusted service processes.
-- Read-only metadata review, safe to run against the active production DB.
DO $guard$
DECLARE
  v_function regprocedure;
  v_signature text;
  v_exposed integer;
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'Expected Supabase database roles not found';
  END IF;

  FOR v_signature IN
    SELECT signature FROM (VALUES
    ('public.apply_default_role_permissions()'),
    ('public.billing_admin_authorize_trial(uuid,uuid,uuid,integer,text)'),
    ('public.guard_client_portal_role_grants()'),
    ('public.guard_lease_activation_property_state()'),
    ('public.guard_property_contract_availability()'),
    ('public.handle_new_user()'),
    ('public.normalize_license_acceptance()'),
    ('public.platform_set_subscription(uuid,text,text,text)'),
    ('public.prevent_duplicate_active_commission()'),
    ('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)'),
    ('public.resolve_consignment_photo_submission(text,uuid,text)')
    ) AS expected(signature)
  LOOP
    v_function := to_regprocedure(v_signature);
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'Required private RPC no longer exists: %', v_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_function
        AND p.prosecdef
        AND EXISTS (
          SELECT 1 FROM unnest(coalesce(p.proconfig,'{}'::text[])) setting
          WHERE setting LIKE 'search_path=%'
        )
    ) THEN
      RAISE EXCEPTION 'Private RPC lost SECURITY DEFINER or fixed search_path: %',
        v_signature;
    END IF;

    IF has_function_privilege('anon',v_function::oid,'EXECUTE')
       OR has_function_privilege('authenticated',v_function::oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Sensitive service-only RPC exposed to API callers: %',
        v_signature;
    END IF;
    IF v_signature = ANY(ARRAY[
      'public.apply_default_role_permissions()',
      'public.guard_client_portal_role_grants()',
      'public.guard_lease_activation_property_state()',
      'public.guard_property_contract_availability()',
      'public.handle_new_user()',
      'public.normalize_license_acceptance()',
      'public.prevent_duplicate_active_commission()'
    ]) AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc WHERE oid=v_function
        AND prorettype='pg_catalog.trigger'::regtype
    ) THEN
      RAISE EXCEPTION 'Internal contract/role trigger is no longer a trigger: %',
        v_signature;
    END IF;
    IF NOT has_function_privilege('service_role',v_function::oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Service role lost access to sensitive RPC: %',
        v_signature;
    END IF;
  END LOOP;

  -- Catch new unsafe overloads, not just the original signatures. An
  -- unexpected signature of a protected service-only function must not
  -- suddenly become an authenticated or anonymous RPC endpoint.
  SELECT count(*) INTO v_exposed
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname=ANY(ARRAY[
      'apply_default_role_permissions','billing_admin_authorize_trial',
      'guard_client_portal_role_grants','guard_lease_activation_property_state',
      'guard_property_contract_availability','handle_new_user',
      'normalize_license_acceptance','platform_set_subscription',
      'prevent_duplicate_active_commission','process_verified_payment_event',
      'resolve_consignment_photo_submission'
    ])
    AND (has_function_privilege('anon',p.oid,'EXECUTE') OR
         has_function_privilege('authenticated',p.oid,'EXECUTE'));
  IF v_exposed<>0 THEN
    RAISE EXCEPTION 'An overloaded service-only function is exposed to API callers';
  END IF;

  RAISE NOTICE 'PASS: 11 sensitive Supabase RPC signatures restricted to service role';
END
$guard$;
