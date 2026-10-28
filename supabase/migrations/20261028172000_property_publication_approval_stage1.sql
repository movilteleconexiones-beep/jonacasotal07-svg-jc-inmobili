-- Public real-estate listings are an explicit, tenant-scoped commercial projection.
-- Private properties, lease data, exact addresses and inventory photographs remain private.
-- This migration does not publish any existing property automatically.
BEGIN;

-- STAGE 1: install a tenant-scoped approval editor without changing any
-- existing public listing / branding RPC or current public properties grants.
-- Public visibility remains managed by the original public catalog until
-- the separate stage-2 cutover, after approvals and verified recovery.

CREATE TABLE public.property_publications (
 property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 published boolean NOT NULL DEFAULT false,
 public_description text CHECK (public_description IS NULL OR char_length(public_description) <= 600),
 -- Publishing is a conscious commercial decision: no empty public listing.
 -- Unpublished drafts may remain without descriptive copy.
 CONSTRAINT property_publication_requires_copy CHECK (
   NOT published OR nullif(btrim(public_description),'') IS NOT NULL
 ),
 public_photo_url text CHECK (
   public_photo_url IS NULL OR (
     char_length(public_photo_url) <= 1500
     AND public_photo_url ~* '^https://[a-z0-9.-]+(:443)?(/[^[:space:]]*)?$'
     AND position('jco-inventory-private' in lower(public_photo_url)) = 0
     AND position('/storage/v1/object/sign/' in lower(public_photo_url)) = 0
     AND position('token=' in lower(public_photo_url)) = 0
   )
 ),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX property_publications_org_live_idx
 ON public.property_publications(organization_id, property_id) WHERE published;

ALTER TABLE public.property_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_publications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_publications TO authenticated;
GRANT ALL ON public.property_publications TO service_role;

-- The row's tenant cannot be forged by a staff member from a different agency.
CREATE FUNCTION private.validate_property_publication_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $jco$
DECLARE actual_org uuid; actual_status text;
BEGIN
 SELECT organization_id, status INTO actual_org, actual_status
   FROM public.properties WHERE id=NEW.property_id;
 IF actual_org IS NULL OR actual_org <> NEW.organization_id THEN
   RAISE EXCEPTION 'Property and publication belong to different organizations' USING ERRCODE='23514';
 END IF;
 -- Even service processes cannot approve an already unavailable property.
 IF NEW.published AND actual_status <> 'AVAILABLE' THEN
   RAISE EXCEPTION 'Only available properties may be published' USING ERRCODE='23514';
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $jco$;
REVOKE ALL ON FUNCTION private.validate_property_publication_tenant() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_public_property_tenant
 BEFORE INSERT OR UPDATE ON public.property_publications
 FOR EACH ROW EXECUTE FUNCTION private.validate_property_publication_tenant();

-- A withdrawn, sold or rented property requires a NEW conscious approval if it
-- becomes available later. Merely restoring AVAILABLE must never republish it.
CREATE FUNCTION private.revoke_unavailable_property_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $jco$
BEGIN
 IF NEW.status IS DISTINCT FROM 'AVAILABLE' THEN
  UPDATE public.property_publications
     SET published=false
   WHERE property_id=NEW.id AND organization_id=NEW.organization_id AND published;
 END IF;
 RETURN NEW;
END $jco$;
REVOKE ALL ON FUNCTION private.revoke_unavailable_property_publication()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER revoke_unavailable_property_publication
 AFTER UPDATE OF status ON public.properties
 FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
 EXECUTE FUNCTION private.revoke_unavailable_property_publication();

CREATE POLICY publication_staff_read ON public.property_publications
 FOR SELECT TO authenticated USING (
   jco_private.is_internal_staff(organization_id)
   AND public.has_org_permission(organization_id,'properties.view')
   AND EXISTS(SELECT 1 FROM public.properties p
      WHERE p.id=property_id AND p.organization_id=organization_id)
 );
CREATE POLICY publication_staff_insert ON public.property_publications
 FOR INSERT TO authenticated WITH CHECK (
   jco_private.is_internal_staff(organization_id)
   AND public.has_org_permission(organization_id,'properties.edit')
   AND EXISTS(SELECT 1 FROM public.properties p
      WHERE p.id=property_id AND p.organization_id=organization_id)
 );
CREATE POLICY publication_staff_update ON public.property_publications
 FOR UPDATE TO authenticated USING (
   jco_private.is_internal_staff(organization_id)
   AND public.has_org_permission(organization_id,'properties.edit')
 ) WITH CHECK (
   jco_private.is_internal_staff(organization_id)
   AND public.has_org_permission(organization_id,'properties.edit')
   AND EXISTS(SELECT 1 FROM public.properties p
      WHERE p.id=property_id AND p.organization_id=organization_id)
 );
CREATE POLICY publication_staff_delete ON public.property_publications
 FOR DELETE TO authenticated USING (
   jco_private.is_internal_staff(organization_id)
   AND public.has_org_permission(organization_id,'properties.edit')
 );

-- No CREATE OR REPLACE of tenant_public_catalog in this stage.
-- Existing public listings remain visible; admins can preapprove safely.
COMMIT;
