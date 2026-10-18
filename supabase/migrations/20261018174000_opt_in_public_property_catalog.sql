-- Public real-estate listings are an explicit, tenant-scoped commercial projection.
-- Private properties, lease data, exact addresses and inventory photographs remain private.
-- This migration does not publish any existing property automatically.
BEGIN;

-- Migration filenames run in timestamp order: this publication migration is
-- applied BEFORE the separate 19:55 private inventory RLS hardening migration.
-- Fail closed at the first phase. Legacy anonymous table grants must never
-- survive the interval between creation of the public catalog and the stronger
-- restrictive SELECT gate. Catalog reads instead use a vetted definer RPC.
-- The 19:55 migration repeats this REVOKE idempotently for defense in depth.
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.properties FROM anon;

CREATE TABLE public.property_publications (
 property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
 organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 published boolean NOT NULL DEFAULT false,
 public_description text CHECK (public_description IS NULL OR char_length(public_description) <= 600),
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

-- Replace public projection: only explicitly approved copy is available.
CREATE OR REPLACE FUNCTION public.tenant_public_catalog(tenant_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
 SELECT jsonb_build_object(
   'company_name', COALESCE(NULLIF(b.company_name,''), o.name),
   'logo_url', b.logo_url,
   'primary_color', b.primary_color,
   'secondary_color', b.secondary_color,
   'phone', b.phone,
   'email', b.email,
   'website', b.website,
   'country', s.country,
   'currency', s.default_currency,
   'locale', s.locale,
   'properties', COALESCE((
     SELECT jsonb_agg(jsonb_build_object(
       'id', p.id, 'code', p.code, 'title', p.title,
       'description', p.public_description,
       'image_url', p.public_photo_url,
       'operation_type', p.operation_type, 'property_type', p.property_type,
       'price', p.price, 'currency', p.currency,
       'country', p.country, 'state', p.state,
       'city', p.city, 'neighborhood', p.neighborhood,
       'bedrooms', p.bedrooms, 'bathrooms', p.bathrooms,
       'parking_spaces', p.parking_spaces,
       'built_area', p.built_area, 'lot_area', p.lot_area,
       'administration_fee', p.administration_fee
     ) ORDER BY p.featured DESC, p.created_at DESC)
     FROM (
       SELECT prop.*, approved.public_description, approved.public_photo_url
       FROM public.properties prop
       JOIN public.property_publications approved
         ON approved.property_id=prop.id
        AND approved.organization_id=prop.organization_id
        AND approved.published IS TRUE
       WHERE prop.organization_id=o.id AND prop.status='AVAILABLE'
       ORDER BY prop.featured DESC, prop.created_at DESC LIMIT 100
     ) p
   ), '[]'::jsonb)
 )
 FROM public.organizations o
 JOIN public.organization_settings s ON s.organization_id=o.id
 LEFT JOIN public.organization_branding b ON b.organization_id=o.id
 WHERE o.slug=tenant_slug AND length(tenant_slug) BETWEEN 2 AND 80
   AND o.status='ACTIVE'
   AND s.enable_public_website IS TRUE
   AND jco_private.operational_access(o.id)
 LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.tenant_public_catalog(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_public_catalog(text) TO anon, authenticated;
COMMENT ON FUNCTION public.tenant_public_catalog(text)
 IS 'Public tenant catalogue: no drafts, no private addresses, no private storage URLs; only active operational organizations.';

COMMIT;
