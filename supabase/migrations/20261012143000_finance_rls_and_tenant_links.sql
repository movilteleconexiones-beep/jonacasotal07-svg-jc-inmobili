-- Staging only. Restrict financial table writes and make every lease relation
-- tenant-composite even when valid UUIDs belong to different organizations.
BEGIN;

-- Abort before acquiring schema locks if historic cross-organization records exist.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.leases l
    JOIN public.properties p ON p.id=l.property_id
    WHERE p.organization_id<>l.organization_id
  ) OR EXISTS (
    SELECT 1 FROM public.leases l
    JOIN public.contacts c ON c.id=l.tenant_id
    WHERE c.organization_id<>l.organization_id
  ) OR EXISTS (
    SELECT 1 FROM public.leases l
    JOIN public.property_owners o ON o.id=l.owner_id
    WHERE o.organization_id<>l.organization_id
  ) THEN
    RAISE EXCEPTION 'Existing cross-organization lease relations require manual review'
      USING ERRCODE='23514';
  END IF;
END
$preflight$;

-- These constraints are needed for a tenant-bound composite FK; existing
-- single-column IDs already have unique primary keys.
ALTER TABLE public.properties
  ADD CONSTRAINT financial_properties_tenant_id_unique UNIQUE (organization_id,id);
ALTER TABLE public.contacts
  ADD CONSTRAINT financial_contacts_tenant_id_unique UNIQUE (organization_id,id);
ALTER TABLE public.property_owners
  ADD CONSTRAINT financial_property_owners_tenant_id_unique UNIQUE (organization_id,id);

-- Replace (do not duplicate) old single-column FKs to avoid ambiguous
-- PostgREST joins against the same destination table.
ALTER TABLE public.leases DROP CONSTRAINT leases_property_id_fkey;
ALTER TABLE public.leases DROP CONSTRAINT leases_tenant_id_fkey;
ALTER TABLE public.leases DROP CONSTRAINT leases_owner_id_fkey;

ALTER TABLE public.leases
  ADD CONSTRAINT leases_property_same_tenant_fk
    FOREIGN KEY (organization_id,property_id)
    REFERENCES public.properties(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT leases_tenant_same_tenant_fk
    FOREIGN KEY (organization_id,tenant_id)
    REFERENCES public.contacts(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT leases_owner_same_tenant_fk
    FOREIGN KEY (organization_id,owner_id)
    REFERENCES public.property_owners(organization_id,id) ON DELETE RESTRICT;

-- Existing tenant membership policies for leases are permissive. Add
-- RESTRICTIVE policies so broad legacy ALL policies cannot bypass granular
-- authorization. Revisit inherited commercial entitlements separately.
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;

CREATE POLICY leases_financial_view ON public.leases AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'leases.view'));
CREATE POLICY leases_financial_insert ON public.leases AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_permission(organization_id,'leases.create'));
CREATE POLICY leases_financial_update ON public.leases AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_org_permission(organization_id,'leases.edit'))
  WITH CHECK (public.has_org_permission(organization_id,'leases.edit'));
REVOKE DELETE ON public.leases FROM PUBLIC,anon,authenticated;

-- A user must never forge an owner's net or mark a payment made directly.
-- create_owner_draft_statement and reconcile_owner_draft_statement are
-- server-only privileged functions that validate organization permissions.
REVOKE INSERT, UPDATE, DELETE ON public.owner_statements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.owner_statements TO authenticated;
ALTER TABLE public.owner_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_statement_financial_view
  ON public.owner_statements AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'owner_statements.view'));

-- The receipt migration already revoked direct rent_payments mutations,
-- but its legacy SELECT rules also need a granular read permission.
ALTER TABLE public.rent_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY rent_payments_financial_view
  ON public.rent_payments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.has_org_permission(organization_id,'rent_payments.view'));

COMMENT ON POLICY leases_financial_insert ON public.leases IS
  'Restrictive tenant permission gate, also enforced against legacy ALL policies.';
COMMIT;
