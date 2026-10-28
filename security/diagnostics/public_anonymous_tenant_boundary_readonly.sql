-- INMOJCO: anonymous public portal boundary diagnostic, READ ONLY.
-- Evaluates real public RPC outputs under the actual anon role, but returns only
-- aggregate counts. Never returns private organization names, slugs or property IDs.
-- Does NOT validate submission RPCs, whose execution would write production data.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- Store candidate scopes while running as a privileged read-only auditor.
SELECT set_config('jco_audit.catalog_scopes',
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'slug',o.slug,
    'expected',o.status='ACTIVE' AND s.enable_public_website IS TRUE
      AND jco_private.operational_access(o.id)))
   FROM public.organizations o
   LEFT JOIN public.organization_settings s ON s.organization_id=o.id),'[]'::jsonb)::text,true);

SELECT set_config('jco_audit.intake_scopes',
  coalesce((SELECT jsonb_agg(jsonb_build_object('slug',p.slug,
    'expected',p.enabled AND o.status='ACTIVE'
      AND coalesce(s.enable_public_website,true)
      AND jco_private.operational_access(o.id)))
   FROM private.property_intake_sites p
   JOIN public.organizations o ON o.id=p.organization_id
   LEFT JOIN public.organization_settings s ON s.organization_id=o.id),'[]'::jsonb)::text,true);

-- Execute the public read RPCs as the role used by unsigned visitors.
SET LOCAL ROLE anon;
SELECT set_config('jco_audit.catalog_outputs',
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',scope->>'id',
     'expected',scope->'expected',
     'result',public.tenant_public_catalog(scope->>'slug')))
   FROM jsonb_array_elements(current_setting('jco_audit.catalog_scopes')::jsonb) scope),'[]'::jsonb)::text,true);
SELECT set_config('jco_audit.intake_outputs',
  coalesce((SELECT jsonb_agg(jsonb_build_object('expected',scope->'expected',
     'result',public.get_public_property_intake_site(scope->>'slug')))
   FROM jsonb_array_elements(current_setting('jco_audit.intake_scopes')::jsonb) scope),'[]'::jsonb)::text,true);
SELECT set_config('jco_audit.unknown_results',
  jsonb_build_object('catalog',public.tenant_public_catalog('__jco_missing__'),
                     'site',public.get_public_property_intake_site('__jco_missing__'))::text,true);
RESET ROLE;

WITH catalogs AS (
  SELECT x->>'id' AS organization_id, x->'expected' AS expected, x->'result' AS result
  FROM jsonb_array_elements(current_setting('jco_audit.catalog_outputs')::jsonb) x
), properties_listed AS (
  SELECT c.organization_id, value AS property
  FROM catalogs c CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.result->'properties','[]'::jsonb)) value
), intake_sites AS (
  SELECT x->'expected' AS expected, x->'result' AS result
  FROM jsonb_array_elements(current_setting('jco_audit.intake_outputs')::jsonb) x
)
SELECT
  (SELECT count(*) FROM catalogs) AS tenants_checked,
  (SELECT count(*) FROM catalogs WHERE result IS NOT NULL) AS catalogs_visible,
  (SELECT count(*) FROM catalogs WHERE (result IS NOT NULL) IS DISTINCT FROM (expected='true'::jsonb)) AS catalog_visibility_violations,
  (SELECT count(*) FROM properties_listed) AS published_properties_checked,
  (SELECT count(*) FROM properties_listed x
     LEFT JOIN public.properties p ON p.id::text=x.property->>'id'
     WHERE p.id IS NULL OR p.organization_id::text<>x.organization_id
       OR p.status<>'AVAILABLE') AS cross_tenant_or_unavailable_properties,
  (SELECT count(*) FROM properties_listed x
     WHERE x.property ?| ARRAY['owner_id','owner_name','tenant_id','contact_phone','internal_notes']
  ) AS properties_with_private_keys,
  (SELECT count(*) FROM intake_sites) AS intake_sites_checked,
  (SELECT count(*) FROM intake_sites WHERE (result IS NOT NULL) IS DISTINCT FROM (expected='true'::jsonb)) AS intake_visibility_violations,
  (SELECT count(*) FROM intake_sites WHERE result IS NOT NULL AND
     result ?| ARRAY['organization_id','owner_id','secret','contact_phone','settings']) AS intake_private_key_violations,
  (current_setting('jco_audit.unknown_results')::jsonb =
   '{"catalog":null,"site":null}'::jsonb) AS nonexistent_slugs_denied;
ROLLBACK;
