-- INMOJCO STAGE 2 — guarded opt-in public catalog cutover.
-- Stage 1 must already be installed and all CURRENTLY VISIBLE listings must
-- have explicit authorization by their own agency. No approvals are invented.
-- This migration must refuse to run if switching would silently remove any
-- currently visible listing from an enabled public organization.
-- Do not run until authentic PostgreSQL+Storage backup and isolated restore
-- have been verified, Git backup refs protected, and owner transition reviewed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Prevent concurrent edits to current listings, approvals and site visibility
-- during the preflight and atomic replacement. Fails after 5s, not an outage.
LOCK TABLE public.properties, public.property_publications,
  public.organizations, public.organization_settings
  IN SHARE ROW EXCLUSIVE MODE;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class
     WHERE oid=to_regclass('public.property_publications')) THEN
    RAISE EXCEPTION 'Stage-one publication approvals are not installed'
      USING ERRCODE='P0001';
  END IF;

  IF EXISTS (
    WITH catalogs AS (
      SELECT o.id AS organization_id,
             public.tenant_public_catalog(o.slug) AS existing_catalog
      FROM public.organizations o
      JOIN public.organization_settings s ON s.organization_id=o.id
      WHERE o.status='ACTIVE' AND s.enable_public_website IS TRUE
        AND jco_private.operational_access(o.id)
    ), visible_properties AS (
      SELECT catalogs.organization_id,
             listing.value->>'id' AS property_id
      FROM catalogs
      CROSS JOIN LATERAL jsonb_array_elements(
        coalesce(catalogs.existing_catalog->'properties','[]'::jsonb)
      ) AS listing(value)
    )
    SELECT 1
    FROM visible_properties visible
    LEFT JOIN public.property_publications approval
      ON approval.property_id::text=visible.property_id
     AND approval.organization_id=visible.organization_id
    WHERE approval.published IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'Cannot cut over public catalog: existing live listings still lack agency approval'
      USING ERRCODE='P0001';
  END IF;
END;
$guard$;

-- Before switching the public RPC, revoke any direct anonymous table access.
-- The legitimate public catalog is served exclusively through the vettted RPC.
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.properties FROM anon;

-- The guarded replacement below retains all live portal branding keys and
-- exposes only approved property copy, never private descriptions or photos.
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
   -- Preserve the full multi-tenant storefront branding contract already
   -- consumed by the current public React application.
   'public_headline', b.public_headline,
   'public_description', b.public_description,
   'public_hero_url', b.public_hero_url,
   'public_office_address', b.public_office_address,
   'public_services', b.public_services,
   'public_page_content', b.public_page_content,
   'whatsapp', b.whatsapp,
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
