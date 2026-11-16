-- G23: bounded, tenant-scoped public catalog pagination; see issue #409.
-- Public brand metadata remains in tenant_public_catalog(text) for backward compatibility.
-- No direct table grants, PII, files or billing mutations. SECURITY DEFINER is deliberate:
-- read only public allowlisted inventory, gated by operational entitlement.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='45s';

CREATE OR REPLACE FUNCTION public.tenant_public_catalog_page(
  tenant_slug text,
  after_featured boolean DEFAULT NULL,
  after_created_at timestamptz DEFAULT NULL,
  after_id uuid DEFAULT NULL,
  page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $g23$
DECLARE
  org_id uuid;
  payload jsonb;
  more boolean;
  cursor_data jsonb;
BEGIN
  -- Reject malformed cursors, oversized pages and noncanonical slugs early.
  IF tenant_slug IS NULL OR length(tenant_slug) NOT BETWEEN 2 AND 80
     OR tenant_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RETURN NULL;
  END IF;
  IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid catalog page size' USING ERRCODE='22023';
  END IF;
  IF (after_featured IS NULL) <> (after_created_at IS NULL)
     OR (after_featured IS NULL) <> (after_id IS NULL) THEN
    RAISE EXCEPTION 'invalid catalog cursor' USING ERRCODE='22023';
  END IF;

  SELECT o.id INTO org_id
  FROM public.organizations AS o
  JOIN public.organization_settings AS s ON s.organization_id=o.id
  WHERE o.slug=tenant_slug
    AND o.status='ACTIVE'
    AND s.enable_public_website IS TRUE
    AND jco_private.operational_access(o.id)
  LIMIT 1;
  IF org_id IS NULL THEN RETURN NULL; END IF;

  WITH page_window AS MATERIALIZED (
    SELECT p.*
    FROM public.properties AS p
    WHERE p.organization_id=org_id
      AND p.status='AVAILABLE'
      AND NOT EXISTS (
        SELECT 1 FROM public.leases AS l
        WHERE l.organization_id=org_id
          AND l.property_id=p.id
          AND l.status IN ('ACTIVE','RENEWAL')
      )
      AND (after_id IS NULL OR
           (p.featured,p.created_at,p.id) < (after_featured,after_created_at,after_id))
    ORDER BY p.featured DESC,p.created_at DESC,p.id DESC
    LIMIT page_size+1
  ), shown AS (
    SELECT * FROM page_window
    ORDER BY featured DESC,created_at DESC,id DESC
    LIMIT page_size
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',p.id,'code',p.code,'title',p.title,
      'description',p.description,
      'operation_type',p.operation_type,'property_type',p.property_type,
      'price',p.price,'currency',p.currency,
      'country',p.country,'state',p.state,'city',p.city,'neighborhood',p.neighborhood,
      'bedrooms',p.bedrooms,'bathrooms',p.bathrooms,
      'parking_spaces',p.parking_spaces,'built_area',p.built_area,
      'lot_area',p.lot_area,'administration_fee',p.administration_fee
    ) ORDER BY p.featured DESC,p.created_at DESC,p.id DESC), '[]'::jsonb),
    (SELECT count(*) > page_size FROM page_window),
    (SELECT jsonb_build_object(
       'after_featured',last_row.featured,
       'after_created_at',last_row.created_at,
       'after_id',last_row.id
     ) FROM shown AS last_row
       ORDER BY last_row.featured ASC,last_row.created_at ASC,last_row.id ASC LIMIT 1)
  INTO payload,more,cursor_data
  FROM shown AS p;

  RETURN jsonb_build_object(
    'properties',payload,
    'has_more',more,
    'next_cursor',CASE WHEN more THEN cursor_data ELSE NULL END
  );
END;
$g23$;

-- Explicit public API: not inadvertently granted via PUBLIC's default EXECUTE.
REVOKE ALL ON FUNCTION public.tenant_public_catalog_page(text,boolean,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_public_catalog_page(text,boolean,timestamptz,uuid,integer)
  TO anon,authenticated,service_role;

-- Partial index keeps paginated public reads proportional to published inventory.
CREATE INDEX IF NOT EXISTS idx_g23_public_properties_cursor
  ON public.properties (organization_id,featured DESC,created_at DESC,id DESC)
  WHERE status='AVAILABLE';

DO $post$
BEGIN
 IF NOT has_function_privilege('anon','public.tenant_public_catalog_page(text,boolean,timestamptz,uuid,integer)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.tenant_public_catalog_page(text,boolean,timestamptz,uuid,integer)','EXECUTE')
 OR NOT has_function_privilege('anon','public.tenant_public_catalog(text)','EXECUTE')
 THEN RAISE EXCEPTION 'G23 public catalogue grants unexpectedly lost'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE oid='public.properties'::regclass AND relrowsecurity IS FALSE)
 THEN RAISE EXCEPTION 'G23 property RLS must remain active'; END IF;
END;
$post$;
COMMIT;
