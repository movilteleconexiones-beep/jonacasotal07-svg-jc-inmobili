-- DRAFT ONLY: transactional serialization of billing authorization changes.
-- Must be tested in isolated PostgreSQL and reviewed staging before any deployment.
BEGIN;
CREATE OR REPLACE FUNCTION public.lock_tenant_billing_authorization(target_org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF target_org IS NULL THEN RAISE EXCEPTION 'Missing organization'; END IF;
 -- UUID-derived advisory transaction lock. Collision only serializes extra tenants.
 PERFORM pg_advisory_xact_lock(hashtextextended(target_org::text, 743821));
END;
$$;
REVOKE ALL ON FUNCTION public.lock_tenant_billing_authorization(uuid) FROM PUBLIC,anon,authenticated;

-- Acquire the identical lock before any change to member permissions or role assignments.
-- Trigger obtains organization from the existing membership; DELETE uses OLD.
CREATE OR REPLACE FUNCTION public.serialize_member_billing_authorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old_org uuid; v_new_org uuid;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN
  SELECT organization_id INTO v_old_org FROM public.organization_members
   WHERE id=OLD.organization_member_id;
 END IF;
 IF TG_OP IN ('UPDATE','INSERT') THEN
  SELECT organization_id INTO v_new_org FROM public.organization_members
   WHERE id=NEW.organization_member_id;
 END IF;
 -- Ordered acquisition prevents cross-organization deadlocks on reassignment.
 IF v_old_org IS NOT NULL AND v_new_org IS NOT NULL AND v_old_org<>v_new_org THEN
  PERFORM public.lock_tenant_billing_authorization(least(v_old_org,v_new_org));
  PERFORM public.lock_tenant_billing_authorization(greatest(v_old_org,v_new_org));
 ELSE
  PERFORM public.lock_tenant_billing_authorization(coalesce(v_old_org,v_new_org));
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS serialize_member_permissions_billing ON public.member_permissions;
CREATE TRIGGER serialize_member_permissions_billing
 BEFORE INSERT OR UPDATE OR DELETE ON public.member_permissions
 FOR EACH ROW EXECUTE FUNCTION public.serialize_member_billing_authorization();
DROP TRIGGER IF EXISTS serialize_member_roles_billing ON public.member_roles;
CREATE TRIGGER serialize_member_roles_billing
 BEFORE INSERT OR UPDATE OR DELETE ON public.member_roles
 FOR EACH ROW EXECUTE FUNCTION public.serialize_member_billing_authorization();

-- Membership deactivation must also serialize with order creation.
CREATE OR REPLACE FUNCTION public.serialize_membership_billing_authorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.lock_tenant_billing_authorization(CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END);
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS serialize_organization_members_billing ON public.organization_members;
CREATE TRIGGER serialize_organization_members_billing
 BEFORE INSERT OR UPDATE OR DELETE ON public.organization_members
 FOR EACH ROW EXECUTE FUNCTION public.serialize_membership_billing_authorization();

-- IMPORTANT: role_permissions and organizations changes are NOT YET protected.
-- Shared roles and lock ordering need independent review; DO NOT DEPLOY.
COMMIT;
