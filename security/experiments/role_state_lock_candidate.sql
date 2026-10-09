-- EXPERIMENTAL ONLY: disposable PostgreSQL, NOT approved for production.
-- Serializes roles.active and role deletion with existing tenant billing locks.
-- WARNING: potential row-lock/advisory-lock inversion under concurrent DML.
BEGIN;
CREATE OR REPLACE FUNCTION public.serialize_role_state_billing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE affected_org uuid;
BEGIN
  IF TG_OP='UPDATE'
     AND OLD.active IS NOT DISTINCT FROM NEW.active
     AND OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id
  THEN RETURN NEW; END IF;

  FOR affected_org IN
    SELECT DISTINCT organization_id
    FROM (
      SELECT om.organization_id
      FROM public.member_roles mr
      JOIN public.organization_members om ON om.id=mr.organization_member_id
      WHERE mr.role_id=CASE WHEN TG_OP='INSERT' THEN NEW.id ELSE OLD.id END
      UNION
      SELECT CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END
    ) orgs
    WHERE organization_id IS NOT NULL
    ORDER BY organization_id
  LOOP
    PERFORM public.lock_tenant_billing_authorization(affected_org);
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.serialize_role_state_billing() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS serialize_role_state_billing ON public.roles;
CREATE TRIGGER serialize_role_state_billing
BEFORE UPDATE OR DELETE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.serialize_role_state_billing();
COMMIT;
