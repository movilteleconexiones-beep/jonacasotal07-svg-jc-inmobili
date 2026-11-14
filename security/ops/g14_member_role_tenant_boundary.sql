-- G14 | 13-nov-2026 | Close tenant-role assignment integrity gap.
-- Assessed in PROD and PG17 restored clone: 0 existing cross-tenant role links,
-- but role-granting authenticated agency user could INSERT a role_id of another org.
-- Do not run supabase db push (#104); apply this exact reviewed SQL once.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

DO $preflight$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'G14 requires trusted migration operator' USING ERRCODE='42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.member_roles mr
    JOIN public.organization_members m ON m.id=mr.organization_member_id
    JOIN public.roles r ON r.id=mr.role_id
    WHERE r.organization_id IS DISTINCT FROM m.organization_id
  ) THEN
    RAISE EXCEPTION 'Historical cross-tenant role assignments require review before G14';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    WHERE c.oid='public.member_roles'::regclass
      AND t.tgname='jco_billing_auth_lock' AND t.tgenabled='O'
  ) THEN
    RAISE EXCEPTION 'Mandatory tenant transaction serializer missing';
  END IF;
END $preflight$;

-- This is a trigger-only function inside an unexposed schema.
-- It does not rely on user-supplied claims: comparisons are DB-enforced.
CREATE OR REPLACE FUNCTION jco_private.guard_member_role_same_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
DECLARE
  member_org uuid;
  role_org uuid;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'member_roles'
      OR TG_OP NOT IN ('INSERT','UPDATE') THEN
    RAISE EXCEPTION 'Unexpected role assignment operation' USING ERRCODE='42501';
  END IF;

  SELECT m.organization_id INTO member_org
    FROM public.organization_members m
    WHERE m.id=NEW.organization_member_id;
  IF member_org IS NULL THEN
    RAISE EXCEPTION 'La membresía no existe' USING ERRCODE='23503';
  END IF;

  SELECT r.organization_id INTO role_org
    FROM public.roles r WHERE r.id=NEW.role_id;
  IF role_org IS NULL OR role_org IS DISTINCT FROM member_org THEN
    RAISE EXCEPTION 'El rol debe pertenecer a la misma inmobiliaria'
      USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$guard$;

REVOKE ALL ON FUNCTION jco_private.guard_member_role_same_tenant()
  FROM PUBLIC, anon, authenticated;

-- Existing jco_billing_auth_lock runs first and serializes the org.
-- Existing z_jco_last_owner_roles_guard runs after this check for UPDATE.
DROP TRIGGER IF EXISTS y_jco_member_role_tenant_guard ON public.member_roles;
CREATE TRIGGER y_jco_member_role_tenant_guard
BEFORE INSERT OR UPDATE ON public.member_roles
FOR EACH ROW EXECUTE FUNCTION jco_private.guard_member_role_same_tenant();

DO $postflight$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_catalog.pg_trigger t
 JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 WHERE c.oid='public.member_roles'::regclass
   AND t.tgname='y_jco_member_role_tenant_guard'
   AND t.tgenabled='O' AND NOT t.tgisinternal;
 IF n<>1 THEN RAISE EXCEPTION 'G14 trigger missing or disabled'; END IF;
 IF EXISTS (
   SELECT 1 FROM public.member_roles mr
   JOIN public.organization_members m ON m.id=mr.organization_member_id
   JOIN public.roles r ON r.id=mr.role_id
   WHERE r.organization_id IS DISTINCT FROM m.organization_id
 ) THEN RAISE EXCEPTION 'G14 integrity failed'; END IF;
END $postflight$;

COMMIT;
