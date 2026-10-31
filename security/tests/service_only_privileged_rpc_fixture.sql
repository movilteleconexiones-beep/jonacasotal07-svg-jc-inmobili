-- CI ONLY: PostgreSQL 17 temporary database; no real Supabase data.
-- Roles live at the CLUSTER level; another CI fixture may have created
-- anon and authenticated in an earlier disposable database.
DO $roles$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon') THEN
   CREATE ROLE anon NOLOGIN;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') THEN
   CREATE ROLE authenticated NOLOGIN;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN
   CREATE ROLE service_role NOLOGIN;
 END IF;
END
$roles$;

DO $fixture$
DECLARE rec record;
BEGIN
 FOR rec IN SELECT signature, return_type FROM (VALUES
    ('public.apply_default_role_permissions()'::text,'trigger'::text),
    ('public.billing_admin_authorize_trial(uuid,uuid,uuid,integer,text)'::text,'boolean'::text),
    ('public.guard_client_portal_role_grants()'::text,'trigger'::text),
    ('public.guard_lease_activation_property_state()'::text,'trigger'::text),
    ('public.guard_property_contract_availability()'::text,'trigger'::text),
    ('public.handle_new_user()'::text,'trigger'::text),
    ('public.normalize_license_acceptance()'::text,'trigger'::text),
    ('public.platform_set_subscription(uuid,text,text,text)'::text,'boolean'::text),
    ('public.prevent_duplicate_active_commission()'::text,'trigger'::text),
    ('public.process_verified_payment_event(text,text,bigint,text,text,text,text,text)'::text,'boolean'::text),
    ('public.resolve_consignment_photo_submission(text,uuid,text)'::text,'boolean'::text)
 ) AS funcs(signature, return_type)
 LOOP
  EXECUTE format(
    'CREATE FUNCTION %s RETURNS %s LANGUAGE %s SECURITY DEFINER SET search_path TO %L AS %L',
    rec.signature, rec.return_type,
    CASE WHEN rec.return_type='trigger' THEN 'plpgsql' ELSE 'sql' END,
    '',
    CASE WHEN rec.return_type='trigger' THEN 'BEGIN RETURN NEW; END'
    ELSE 'SELECT true' END
  );
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',rec.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',rec.signature);
 END LOOP;
END
$fixture$;
