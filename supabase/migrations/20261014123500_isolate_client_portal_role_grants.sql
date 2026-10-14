-- A CLIENT profile is a private portal identity. It must never inherit
-- tenant-wide operational permissions such as clients.view or rent_payments.view.
-- Its access is determined by portal_access_links and the portal's RLS policies.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.roles r
    JOIN public.role_permissions rp ON rp.role_id=r.id
    WHERE r.key='CLIENT'
  ) THEN
    RAISE EXCEPTION
      'Cannot harden CLIENT role: existing grants must first be reviewed and removed manually';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_client_portal_role_grants()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.roles r WHERE r.id=NEW.role_id AND r.key='CLIENT'
  ) THEN
    RAISE EXCEPTION
      'Client portal roles cannot receive tenant-wide operational permissions'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_client_portal_role_grants()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER portal_client_role_grants_guard
  BEFORE INSERT OR UPDATE OF role_id,permission_id ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_portal_role_grants();

COMMIT;
