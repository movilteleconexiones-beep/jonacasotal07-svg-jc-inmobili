-- REVIEW/STAGING FIRST: do not apply to production before a schema and API-join review.
-- Enforce organization consistency across CRM, deals and commission references.
-- Existing single-column foreign keys are replaced, NOT duplicated: PostgREST
-- relationships (e.g. contacts(...), properties(...), deals(...)) remain unique.
BEGIN;

-- The referenced identifiers are already unique globally. PostgreSQL requires
-- an explicit uniqueness guarantee on the composite referenced columns.
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_tenant_identity_key UNIQUE (organization_id,id);
ALTER TABLE public.properties
  ADD CONSTRAINT properties_tenant_identity_key UNIQUE (organization_id,id);
ALTER TABLE public.deals
  ADD CONSTRAINT deals_tenant_identity_key UNIQUE (organization_id,id);

-- Fail safely and roll back the entire transaction if legacy references cross
-- tenant boundaries. Repair data in a reviewed plan rather than silently moving it.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.leads l
    LEFT JOIN public.contacts c ON c.id=l.contact_id AND c.organization_id=l.organization_id
    WHERE c.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.leads l
    LEFT JOIN public.properties p ON p.id=l.property_id AND p.organization_id=l.organization_id
    WHERE l.property_id IS NOT NULL AND p.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.deals d
    LEFT JOIN public.contacts c ON c.id=d.contact_id AND c.organization_id=d.organization_id
    WHERE c.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.deals d
    LEFT JOIN public.properties p ON p.id=d.property_id AND p.organization_id=d.organization_id
    WHERE p.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.commissions c
    LEFT JOIN public.deals d ON d.id=c.deal_id AND d.organization_id=c.organization_id
    WHERE d.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-organization CRM reference exists; migration aborted';
  END IF;
END
$preflight$;

-- Preserve the existing delete actions. In particular, deleting an optional
-- lead property must NOT clear leads.organization_id.
ALTER TABLE public.leads DROP CONSTRAINT leads_contact_id_fkey;
ALTER TABLE public.leads DROP CONSTRAINT leads_property_id_fkey;
ALTER TABLE public.deals DROP CONSTRAINT deals_contact_id_fkey;
ALTER TABLE public.deals DROP CONSTRAINT deals_property_id_fkey;
ALTER TABLE public.commissions DROP CONSTRAINT commissions_deal_id_fkey;

ALTER TABLE public.leads ADD CONSTRAINT leads_contact_same_tenant_fk
  FOREIGN KEY (organization_id,contact_id) REFERENCES public.contacts(organization_id,id)
  ON DELETE CASCADE NOT VALID;
ALTER TABLE public.leads ADD CONSTRAINT leads_property_same_tenant_fk
  FOREIGN KEY (organization_id,property_id) REFERENCES public.properties(organization_id,id)
  ON DELETE SET NULL (property_id) NOT VALID;
ALTER TABLE public.deals ADD CONSTRAINT deals_contact_same_tenant_fk
  FOREIGN KEY (organization_id,contact_id) REFERENCES public.contacts(organization_id,id)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.deals ADD CONSTRAINT deals_property_same_tenant_fk
  FOREIGN KEY (organization_id,property_id) REFERENCES public.properties(organization_id,id)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_deal_same_tenant_fk
  FOREIGN KEY (organization_id,deal_id) REFERENCES public.deals(organization_id,id)
  ON DELETE CASCADE NOT VALID;

ALTER TABLE public.leads VALIDATE CONSTRAINT leads_contact_same_tenant_fk;
ALTER TABLE public.leads VALIDATE CONSTRAINT leads_property_same_tenant_fk;
ALTER TABLE public.deals VALIDATE CONSTRAINT deals_contact_same_tenant_fk;
ALTER TABLE public.deals VALIDATE CONSTRAINT deals_property_same_tenant_fk;
ALTER TABLE public.commissions VALIDATE CONSTRAINT commissions_deal_same_tenant_fk;
COMMIT;
