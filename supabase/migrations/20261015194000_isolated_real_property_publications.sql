-- Public real-estate listings are an explicit, tenant-scoped commercial projection.
-- Private properties, lease data, exact addresses and inventory photographs remain private.
-- This migration does not publish any existing property automatically.
BEGIN;

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
DECLARE actual_org uuid;
BEGIN
 SELECT organization_id INTO actual_org
   FROM public.properties WHERE id=NEW.property_id;
 IF actual_org IS NULL OR actual_org <> NEW.organization_id THEN
   RAISE EXCEPTION 'Property and publication belong to different organizations' USING ERRCODE='23514';
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $jco$;
REVOKE ALL ON FUNCTION private.validate_property_publication_tenant() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validate_public_property_tenant
 BEFORE INSERT OR UPDATE ON public.property_publications
 FOR EACH ROW EXECUTE FUNCTION private.validate_property_publication_tenant();

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

-- The only anonymous entry point. Requires an enabled, ACTIVE site resolved by
-- its unique server-owned slug. Never allows a client-supplied organization_id.
-- Does not expose owner contact, full address, coordinates, confidential notes,
-- private storage references or draft/sold/rented/reserved properties.
CREATE FUNCTION public.get_public_agency_listings(p_site_slug text, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $jco$
 SELECT COALESCE(jsonb_agg(
   jsonb_build_object(
     'id', x.id, 'code', x.code, 'title', x.title,
     'operation_type', x.operation_type, 'property_type', x.property_type,
     'price', x.price, 'currency', x.currency, 'country', x.country,
     'state', x.state, 'city', x.city, 'neighborhood', x.neighborhood,
     'bedrooms', x.bedrooms, 'bathrooms', x.bathrooms,
     'parking_spaces', x.parking_spaces, 'built_area', x.built_area,
     'lot_area', x.lot_area, 'featured', x.featured,
     'description', x.public_description, 'image_url', x.public_photo_url
   ) ORDER BY x.featured DESC, x.code
 ), '[]'::jsonb)
 FROM (
   SELECT p.id, p.code, p.title, p.operation_type, p.property_type,
          p.price, p.currency, p.country, p.state, p.city, p.neighborhood,
          p.bedrooms, p.bathrooms, p.parking_spaces, p.built_area,
          p.lot_area, p.featured, pub.public_description, pub.public_photo_url
   FROM private.property_intake_sites s
   JOIN public.organizations o ON o.id=s.organization_id AND o.status='ACTIVE'
   LEFT JOIN public.organization_settings os ON os.organization_id=o.id
   JOIN public.properties p ON p.organization_id=o.id AND p.status='AVAILABLE'
   JOIN public.property_publications pub
     ON pub.property_id=p.id AND pub.organization_id=o.id AND pub.published
   WHERE p_site_slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'
     AND s.slug=p_site_slug
     AND s.enabled
     AND COALESCE(os.enable_public_website,true)
   ORDER BY p.featured DESC,p.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit,24),1),48)
   OFFSET GREATEST(LEAST(COALESCE(p_offset,0),20000),0)
 ) x;
$jco$;
REVOKE ALL ON FUNCTION public.get_public_agency_listings(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_agency_listings(text,integer,integer) TO anon,authenticated;
-- Agency administrators can activate their own storefront, never a different
-- organization's. A public site alone publishes ZERO private properties.
CREATE FUNCTION public.get_my_agency_public_site(p_organization_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $jco$
 SELECT jsonb_build_object('slug',s.slug,'enabled',s.enabled)
 FROM private.property_intake_sites s
 WHERE s.organization_id=p_organization_id
   AND jco_private.is_internal_staff(p_organization_id)
   AND public.has_org_permission(p_organization_id,'settings.view');
$jco$;
REVOKE ALL ON FUNCTION public.get_my_agency_public_site(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_agency_public_site(uuid) TO authenticated;

CREATE FUNCTION public.configure_my_agency_public_site(p_organization_id uuid,p_enabled boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $jco$
DECLARE target_slug text;
BEGIN
 IF p_organization_id IS NULL OR p_enabled IS NULL
   OR NOT jco_private.is_internal_staff(p_organization_id)
   OR NOT public.has_org_permission(p_organization_id,'settings.edit') THEN
   RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';
 END IF;
 SELECT slug INTO target_slug FROM public.organizations
 WHERE id=p_organization_id AND status='ACTIVE' FOR UPDATE;
 IF target_slug IS NULL OR target_slug !~ '^[a-z0-9][a-z0-9-]{2,79}
 THEN
   RAISE EXCEPTION 'Valid active agency slug required' USING ERRCODE='22023';
 END IF;
 INSERT INTO private.property_intake_sites(slug,organization_id,enabled)
 VALUES(target_slug,p_organization_id,p_enabled)
 ON CONFLICT(organization_id) DO UPDATE SET enabled=excluded.enabled;
 RETURN (SELECT slug FROM private.property_intake_sites
         WHERE organization_id=p_organization_id);
END $jco$;
REVOKE ALL ON FUNCTION public.configure_my_agency_public_site(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_my_agency_public_site(uuid,boolean) TO authenticated;
COMMIT;
