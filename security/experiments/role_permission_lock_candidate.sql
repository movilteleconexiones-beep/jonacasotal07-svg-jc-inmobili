-- EXPERIMENTAL ONLY. Do not deploy: deadlock/cascade/global-role review outstanding.
-- Isolated regression candidate for the role_permissions revocation race.
BEGIN;
CREATE OR REPLACE FUNCTION public.serialize_role_permission_billing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE affected_org uuid;
BEGIN
  -- Global roles can be assigned to multiple organizations.
  -- Acquire every affected tenant's advisory lock in stable UUID order.
  FOR affected_org IN
    SELECT DISTINCT om.organization_id
    FROM public.member_roles mr
    JOIN public.organization_members om ON om.id = mr.organization_member_id
    WHERE mr.role_id = ANY(
      ARRAY[
        CASE WHEN TG_OP IN ('DELETE','UPDATE') THEN OLD.role_id ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN NEW.role_id ELSE NULL END
      ]::uuid[]
    )
    ORDER BY om.organization_id
  LOOP
    PERFORM public.lock_tenant_billing_authorization(affected_org);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.serialize_role_permission_billing() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS serialize_role_permissions_billing ON public.role_permissions;
CREATE TRIGGER serialize_role_permissions_billing
BEFORE INSERT OR UPDATE OR DELETE ON public.role_permissions
FOR EACH ROW EXECUTE FUNCTION public.serialize_role_permission_billing();
COMMIT;
-- Open issues: row-lock ordering and deadlocks on UPDATE/DELETE,
-- role deletion cascades, global role membership races, organization status.
