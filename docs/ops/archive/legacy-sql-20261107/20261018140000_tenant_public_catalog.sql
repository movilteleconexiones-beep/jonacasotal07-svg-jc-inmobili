-- Tenant public listing: only paid/operational, published records. No private photo URLs or addresses.
BEGIN;
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
       'description', p.description,
       'operation_type', p.operation_type, 'property_type', p.property_type,
       'price', p.price, 'currency', p.currency,
       'country', p.country, 'state', p.state,
       'city', p.city, 'neighborhood', p.neighborhood,
       'bedrooms', p.bedrooms, 'bathrooms', p.bathrooms,
       'parking_spaces', p.parking_spaces,
       'built_area', p.built_area, 'lot_area', p.lot_area,
       'administration_fee', p.administration_fee
     ) ORDER BY p.featured DESC, p.created_at DESC)
     FROM (SELECT *
           FROM public.properties
           WHERE organization_id=o.id AND status='AVAILABLE'
           ORDER BY featured DESC, created_at DESC LIMIT 100) p
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
