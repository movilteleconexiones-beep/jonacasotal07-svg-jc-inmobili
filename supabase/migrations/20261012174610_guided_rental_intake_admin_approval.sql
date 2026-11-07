-- Guided rental onboarding: agents prepare drafts; administrators activate after
-- checking a private signed contract. Reuses previously deployed finance tables.
-- Do not use supabase db push blindly until issue #104 is reconciled.
BEGIN;

-- Avoid silently changing roles in tenants that have no administrator capable
-- of reviewing/activating leases. Do not grant leases.edit or rent_payments.*.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT agent.id, permission.id
FROM public.roles agent
JOIN public.permissions permission ON permission.key IN ('leases.view','leases.create')
WHERE agent.key='AGENT' AND agent.active
  AND EXISTS (
    SELECT 1 FROM public.roles admin_role
    JOIN public.role_permissions grant_row ON grant_row.role_id=admin_role.id
    JOIN public.permissions admin_permission ON admin_permission.id=grant_row.permission_id
    WHERE admin_role.organization_id=agent.organization_id
      AND admin_role.key='ADMIN' AND admin_role.active
      AND admin_permission.key='leases.edit'
  )
ON CONFLICT DO NOTHING;

-- A property may be rented again after the previous contract is FINISHED.
-- The unique index also handles simultaneous activation attempts atomically.
CREATE UNIQUE INDEX leases_one_occupied_contract_per_property
  ON public.leases(organization_id,property_id)
  WHERE status IN ('ACTIVE','RENEWAL');

CREATE FUNCTION public.guard_rental_activation_with_signed_contract()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog
AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.status IN ('ACTIVE','RENEWAL')
       AND OLD.status NOT IN ('ACTIVE','RENEWAL') THEN
    IF OLD.status <> 'DRAFT' OR NEW.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Only a draft contract can be activated by an administrator'
        USING ERRCODE='23514';
    END IF;
    IF auth.uid() IS NULL OR
      NOT public.has_org_permission(NEW.organization_id,'leases.edit') OR
      NOT EXISTS (
        SELECT 1
        FROM public.organization_members member
        JOIN public.member_roles mr ON mr.organization_member_id=member.id
        JOIN public.roles role ON role.id=mr.role_id
        WHERE member.organization_id=NEW.organization_id
          AND member.user_id=auth.uid()
          AND member.status='ACTIVE'
          AND role.active AND role.key='ADMIN'
          AND role.organization_id=NEW.organization_id
      ) THEN
      RAISE EXCEPTION 'Only an authorized agency administrator can activate contracts'
        USING ERRCODE='42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.documents doc
      JOIN storage.objects file ON file.bucket_id=doc.storage_bucket
        AND file.name=doc.storage_path
      WHERE doc.organization_id=NEW.organization_id
        AND doc.entity_type='GENERAL' AND doc.entity_id=NEW.id
        AND doc.document_type='CONTRACT'
        AND doc.storage_bucket='organization-documents'
        AND doc.mime_type='application/pdf'
        AND doc.storage_path LIKE
          (NEW.organization_id::text || '/leases/' || NEW.id::text || '/signed/%.pdf')
    ) THEN
      RAISE EXCEPTION 'Attach the signed private PDF before administrator activation'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_rental_activation_with_signed_contract()
  FROM PUBLIC,anon,authenticated;
CREATE TRIGGER leases_require_signed_pdf_and_admin
  BEFORE UPDATE OF status ON public.leases FOR EACH ROW
  EXECUTE FUNCTION public.guard_rental_activation_with_signed_contract();

COMMENT ON FUNCTION public.guard_rental_activation_with_signed_contract() IS
  'Only an active ADMIN with leases.edit can activate a draft when a private signed PDF exists. Unique occupied-property index avoids double renting.';
COMMIT;
