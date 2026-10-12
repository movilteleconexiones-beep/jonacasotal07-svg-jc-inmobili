-- Deals: safe administrator-only deletion. Never cascade into commissions or activities.
-- This migration is applied independently while historical versions remain under review (#104).
BEGIN;

-- The legacy commercial ALL policy must not enable direct deletes by browser clients.
-- Keep service_role permissions for approved backend maintenance.
REVOKE DELETE ON TABLE public.deals FROM PUBLIC, anon, authenticated;

-- Editing a client/property must never link records belonging to another agency.
-- Both parent tables already have tenant-composite UNIQUE constraints in production.
ALTER TABLE public.deals
  ADD CONSTRAINT deals_contact_same_org_fk
  FOREIGN KEY (organization_id, contact_id)
  REFERENCES public.contacts(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE public.deals
  ADD CONSTRAINT deals_property_same_org_fk
  FOREIGN KEY (organization_id, property_id)
  REFERENCES public.properties(organization_id, id) ON DELETE RESTRICT;

CREATE FUNCTION public.delete_unlinked_deal(
  target_org uuid, target_deal uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  actor uuid := auth.uid();
  deal_row public.deals%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT public.has_org_permission(target_org,'deals.close') OR
    NOT EXISTS (
      SELECT 1
      FROM public.organization_members member
      JOIN public.member_roles mr ON mr.organization_member_id = member.id
      JOIN public.roles role ON role.id = mr.role_id
      WHERE member.organization_id = target_org
        AND member.user_id = actor AND member.status = 'ACTIVE'
        AND role.key = 'ADMIN' AND role.active
        AND role.organization_id = target_org
    ) THEN
    RAISE EXCEPTION 'Solo el administrador autorizado puede eliminar negocios'
      USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE serializes against concurrent FK inserts that reference this deal.
  SELECT * INTO deal_row
  FROM public.deals
  WHERE id = target_deal AND organization_id = target_org
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF deal_row.stage IN ('WON','LOST') OR
    EXISTS (SELECT 1 FROM public.activities a WHERE a.deal_id = target_deal) OR
    EXISTS (SELECT 1 FROM public.commissions c WHERE c.deal_id = target_deal) THEN
    RAISE EXCEPTION 'Este negocio tiene cierre o historial vinculado. No puede eliminarse; conserva su trazabilidad.'
      USING ERRCODE = '23503';
  END IF;

  -- Preserve an audit trail without exposing tenant information to other organizations.
  INSERT INTO public.audit_log (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    target_org, actor, 'deals.delete', 'DEAL', target_deal,
    pg_catalog.jsonb_build_object(
      'contact_id', deal_row.contact_id,
      'property_id', deal_row.property_id,
      'operation_type', deal_row.operation_type,
      'previous_stage', deal_row.stage
    )
  );

  DELETE FROM public.deals
  WHERE id = target_deal AND organization_id = target_org;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_unlinked_deal(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unlinked_deal(uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.delete_unlinked_deal(uuid,uuid) IS
  'ADMIN + deals.close only, prevents CASCADE loss of deal activities/commissions, audits deletion.';

COMMIT;
