-- Fictional legacy storefront RPC, mimicking pre-cutover visibility.
-- Only executed against the disposable CI database.
CREATE OR REPLACE FUNCTION public.tenant_public_catalog(tenant_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT jsonb_build_object('company_name',o.name,'properties',coalesce((
   SELECT jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'description',p.description))
   FROM public.properties p
   WHERE p.organization_id=o.id AND p.status='AVAILABLE'
 ),'[]'::jsonb))
 FROM public.organizations o
 JOIN public.organization_settings s ON s.organization_id=o.id
 WHERE o.slug=tenant_slug AND o.status='ACTIVE' AND s.enable_public_website IS TRUE
   AND jco_private.operational_access(o.id)
 LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.tenant_public_catalog(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_public_catalog(text) TO anon,authenticated;
