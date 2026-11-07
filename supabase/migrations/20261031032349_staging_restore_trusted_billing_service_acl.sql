-- #325: Branch-only prerequisite. Never run in production.
-- Branches do not inherit production's default public schema privileges.
BEGIN;
DO $check$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'Missing organizations before staging ACL prerequisite';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid='public.organizations'::regclass) THEN
    RAISE EXCEPTION 'Organizations RLS must remain enabled';
  END IF;
END
$check$;
GRANT UPDATE ON TABLE public.organizations TO service_role;
COMMIT;
