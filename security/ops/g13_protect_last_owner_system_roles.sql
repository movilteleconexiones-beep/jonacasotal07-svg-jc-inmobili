-- G13: prevent last-owner loss through DIRECT table writes, including privileged SQL.
-- No RLS grants, org moves or financial/billing writes. Keep historical role grants.
-- Existing jco_billing_auth_lock BEFORE trigger serializes edits on organizations.
-- "z_" runs AFTER the existing serialization trigger (Postgres alphabetical order).
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
  IF current_user<>'postgres' THEN
    RAISE EXCEPTION 'G13 installation requires trusted migration operator'
      USING ERRCODE='42501';
  END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION jco_private.guard_protected_membership_mutations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $guard$
DECLARE
  v_org uuid;
  v_user uuid;
  v_active boolean;
  v_owner_role boolean;
  v_drops_owner boolean := false;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' THEN
    RAISE EXCEPTION 'Unexpected membership guard schema' USING ERRCODE='42501';
  END IF;

  IF TG_TABLE_NAME='roles' THEN
    -- Deleting a built-in role bypassed the existing BEFORE UPDATE identity guard.
    IF TG_OP='DELETE' AND OLD.is_system_role THEN
      RAISE EXCEPTION 'No se puede eliminar un rol del sistema' USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME='organization_members' THEN
    v_org := OLD.organization_id;
    v_user := OLD.user_id;
    v_active := OLD.status='ACTIVE';
    IF TG_OP='UPDATE' THEN
      IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'La identidad y la inmobiliaria de una membresía son inmutables'
          USING ERRCODE='42501';
      END IF;
      v_drops_owner := v_active AND NEW.status IS DISTINCT FROM 'ACTIVE';
    ELSE
      v_drops_owner := v_active;
    END IF;
  ELSIF TG_TABLE_NAME='member_roles' THEN
    SELECT m.organization_id,m.user_id,(m.status='ACTIVE')
      INTO v_org,v_user,v_active
      FROM public.organization_members m
      WHERE m.id=OLD.organization_member_id;
    IF v_user IS NULL THEN
      -- A member already removed by a cascading cleanup has no privileges left;
      -- membership DELETE itself is guarded before removal.
      IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
    IF TG_OP='DELETE' THEN
      v_drops_owner:=true;
    ELSE
      v_drops_owner :=
        NEW.organization_member_id IS DISTINCT FROM OLD.organization_member_id
        OR NEW.role_id IS DISTINCT FROM OLD.role_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unexpected membership guard table' USING ERRCODE='42501';
  END IF;

  -- A platform administrator is immutable through generic member/role DML.
  -- Account lifecycle is handled only through a dedicated audited procedure.
  IF EXISTS (SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id=v_user AND pa.active) THEN
    RAISE EXCEPTION 'La cuenta del SuperAdmin está protegida' USING ERRCODE='42501';
  END IF;

  IF v_active AND v_drops_owner THEN
    IF TG_TABLE_NAME='organization_members' THEN
      SELECT EXISTS(
        SELECT 1 FROM public.member_roles mr
        JOIN public.roles r ON r.id=mr.role_id
        WHERE mr.organization_member_id=OLD.id
          AND r.organization_id=v_org
          AND r.key='ORGANIZATION_OWNER' AND r.active
      ) INTO v_owner_role;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.roles r WHERE r.id=OLD.role_id
          AND r.organization_id=v_org
          AND r.key='ORGANIZATION_OWNER' AND r.active
      ) INTO v_owner_role;
    END IF;
    IF v_owner_role AND NOT EXISTS(
      SELECT 1 FROM public.organization_members m
      JOIN public.member_roles mr ON mr.organization_member_id=m.id
      JOIN public.roles r ON r.id=mr.role_id AND r.organization_id=m.organization_id
      WHERE m.organization_id=v_org
        AND m.user_id IS DISTINCT FROM v_user
        AND m.status='ACTIVE'
        AND r.key='ORGANIZATION_OWNER' AND r.active
    ) THEN
      RAISE EXCEPTION 'No se puede suspender ni retirar al último propietario activo'
        USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$guard$;

DROP TRIGGER IF EXISTS z_jco_last_owner_membership_guard ON public.organization_members;
CREATE TRIGGER z_jco_last_owner_membership_guard
BEFORE UPDATE OR DELETE ON public.organization_members FOR EACH ROW
EXECUTE FUNCTION jco_private.guard_protected_membership_mutations();

DROP TRIGGER IF EXISTS z_jco_last_owner_roles_guard ON public.member_roles;
CREATE TRIGGER z_jco_last_owner_roles_guard
BEFORE UPDATE OR DELETE ON public.member_roles FOR EACH ROW
EXECUTE FUNCTION jco_private.guard_protected_membership_mutations();

DROP TRIGGER IF EXISTS z_jco_system_role_delete_guard ON public.roles;
CREATE TRIGGER z_jco_system_role_delete_guard
BEFORE DELETE ON public.roles FOR EACH ROW
EXECUTE FUNCTION jco_private.guard_protected_membership_mutations();

-- TRIGGER functions are not callable as ordinary RPCs; revoke inherited
-- PUBLIC EXECUTE anyway as defense in depth on the non-exposed schema.
REVOKE ALL ON FUNCTION jco_private.guard_protected_membership_mutations()
  FROM PUBLIC, anon, authenticated;

-- The older billing trigger must run first and serialize changes by org.
DO $checks$
DECLARE v_total integer;
BEGIN
 SELECT count(*) INTO v_total FROM pg_trigger t
 JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND t.tgname IN (
 'z_jco_last_owner_membership_guard','z_jco_last_owner_roles_guard','z_jco_system_role_delete_guard'
 ) AND NOT t.tgisinternal AND t.tgenabled='O';
 IF v_total<>3 THEN RAISE EXCEPTION 'Expected exactly 3 G13 enabled guards, found %',v_total; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   WHERE c.relname='organization_members' AND t.tgname='jco_billing_auth_lock')
 OR NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   WHERE c.relname='member_roles' AND t.tgname='jco_billing_auth_lock') THEN
   RAISE EXCEPTION 'Required organization-serialization triggers missing';
 END IF;
END $checks$;
COMMIT;
