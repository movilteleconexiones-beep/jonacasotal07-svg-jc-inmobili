-- G08 #91: REVIEW ONLY. No production migration until staging/PostgREST E2E signoff.
-- property_ownerships has no organization_id: use a protected derived tenant check
-- rather than an incompatible non-null column in the existing app.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '25s';
-- Prevent a time-of-check/time-of-use race: a concurrent INSERT into the
-- link table, or a parent organization_id UPDATE, must not slip between the
-- cross-tenant preflight and installation of the protecting triggers.
-- SHARE ROW EXCLUSIVE blocks concurrent DML but permits ordinary SELECT.
-- lock_timeout aborts the WHOLE transaction if a busy table cannot be locked.
LOCK TABLE public.property_ownerships, public.properties, public.property_owners
 IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Expected postgres migration executor'; END IF;
 IF to_regprocedure('jco_private.enforce_ownership_same_tenant()') IS NOT NULL
    OR to_regprocedure('jco_private.prevent_ownership_parent_reassignment()') IS NOT NULL
 THEN RAISE EXCEPTION 'Ownership tenant guards already present: inspect before replacing'; END IF;
 IF EXISTS(
  SELECT 1 FROM public.property_ownerships link
   JOIN public.properties p ON p.id=link.property_id
   JOIN public.property_owners owner ON owner.id=link.owner_id
   WHERE p.organization_id IS DISTINCT FROM owner.organization_id
 ) THEN RAISE EXCEPTION 'Existing ownership relationship crosses tenants'; END IF;
END $preflight$;

CREATE FUNCTION jco_private.enforce_ownership_same_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $guard$
DECLARE v_property_org uuid;v_owner_org uuid;
BEGIN
 -- FOR SHARE locks the parent org identity against concurrent cross-tenant reassignment.
 SELECT organization_id INTO v_property_org FROM public.properties
   WHERE id=NEW.property_id FOR SHARE;
 SELECT organization_id INTO v_owner_org FROM public.property_owners
   WHERE id=NEW.owner_id FOR SHARE;
 IF v_property_org IS NULL OR v_owner_org IS NULL
    OR v_property_org IS DISTINCT FROM v_owner_org THEN
  RAISE EXCEPTION 'Property and owner must belong to the same organization'
   USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $guard$;

CREATE FUNCTION jco_private.prevent_ownership_parent_reassignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $guard$
DECLARE v_has_owner_links boolean;
BEGIN
 IF OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='properties' THEN
   SELECT EXISTS(SELECT 1 FROM public.property_ownerships x WHERE x.property_id=OLD.id)
     INTO v_has_owner_links;
 ELSIF TG_TABLE_NAME='property_owners' THEN
   SELECT EXISTS(SELECT 1 FROM public.property_ownerships x WHERE x.owner_id=OLD.id)
     INTO v_has_owner_links;
 ELSE
   RAISE EXCEPTION 'Unexpected ownership guard trigger table' USING ERRCODE='23514';
 END IF;
 IF v_has_owner_links THEN
   RAISE EXCEPTION 'Cannot change organization of a property/owner with ownership links'
    USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $guard$;

REVOKE ALL ON FUNCTION jco_private.enforce_ownership_same_tenant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION jco_private.prevent_ownership_parent_reassignment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_property_ownership_same_tenant
 BEFORE INSERT OR UPDATE OF property_id,owner_id
 ON public.property_ownerships FOR EACH ROW
 EXECUTE FUNCTION jco_private.enforce_ownership_same_tenant();

CREATE TRIGGER prevent_property_link_tenant_reassignment
 BEFORE UPDATE OF organization_id
 ON public.properties FOR EACH ROW
 EXECUTE FUNCTION jco_private.prevent_ownership_parent_reassignment();

CREATE TRIGGER prevent_owner_link_tenant_reassignment
 BEFORE UPDATE OF organization_id
 ON public.property_owners FOR EACH ROW
 EXECUTE FUNCTION jco_private.prevent_ownership_parent_reassignment();

DO $postflight$
BEGIN
 IF (SELECT count(*) FROM pg_trigger
     WHERE tgname IN ('enforce_property_ownership_same_tenant',
       'prevent_property_link_tenant_reassignment','prevent_owner_link_tenant_reassignment')
      AND NOT tgisinternal AND tgenabled='O')<>3
 THEN RAISE EXCEPTION 'Ownership tenant trigger set incomplete'; END IF;
END $postflight$;
