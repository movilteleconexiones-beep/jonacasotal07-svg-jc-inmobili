-- INMOJCO #203: READ-ONLY inventory of approved anonymous SECURITY DEFINER RPCs.
-- Do not blanket-revoke: these four endpoints are required by the public portal.
-- Prevent expansion of anonymous executable privileged functions and public DDL.
-- Catalog only; no tenant rows, no schema mutation.
WITH expected(proname,args) AS (
 VALUES
  ('get_public_property_intake_site','p_slug text'),
  ('submit_property_consignment','p_site_slug text, p_request_id uuid, p_payload jsonb'),
  ('submit_public_website_lead','p_slug text, p_name text, p_email text, p_phone text, p_service text, p_message text, p_consent boolean, p_trap text'),
  ('tenant_public_catalog','tenant_slug text')
), privileged AS (
 SELECT p.oid,p.proname,pg_get_function_identity_arguments(p.oid) AS args,
  p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon_exec,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_exec
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef
), unexpected AS (
 SELECT p.oid FROM privileged p LEFT JOIN expected e ON e.proname=p.proname AND e.args=p.args
 WHERE p.anon_exec AND e.proname IS NULL
), missing AS (
 SELECT e.proname FROM expected e LEFT JOIN privileged p
 ON p.proname=e.proname AND p.args=e.args AND p.anon_exec
 WHERE p.oid IS NULL
), bad_config AS (
 SELECT p.oid FROM privileged p
 WHERE p.anon_exec AND (
   (SELECT count(*) FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) c(x)
    WHERE x LIKE 'search_path=%')<>1
   OR NOT ('search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[])))
 )
), bad_schema_acl AS (
 SELECT r.rolname FROM pg_roles r
 WHERE r.rolname IN ('anon','authenticated')
   AND has_schema_privilege(r.oid,'public','CREATE')
), duplicate_paths AS (
 SELECT p.oid FROM privileged p
 WHERE (p.anon_exec OR p.auth_exec)
 AND (SELECT count(*) FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) c(x)
      WHERE x LIKE 'search_path=%')<>1
)
SELECT label, observed, expected_count,
 CASE WHEN observed=expected_count THEN 'OK' ELSE 'DRIFT' END AS finding
FROM (
 SELECT 'approved_anon_definer_rpc_count' AS label,count(*)::int AS observed,4 AS expected_count
 FROM privileged WHERE anon_exec
 UNION ALL SELECT 'missing_approved_anon_rpcs',count(*)::int,0 FROM missing
 UNION ALL SELECT 'unexpected_anon_definer_rpcs',count(*)::int,0 FROM unexpected
 UNION ALL SELECT 'anon_nonempty_or_duplicate_search_path',count(*)::int,0 FROM bad_config
 UNION ALL SELECT 'anon_or_authenticated_can_create_public',count(*)::int,0 FROM bad_schema_acl
 UNION ALL SELECT 'exposed_definer_missing_or_duplicate_search_path',count(*)::int,0 FROM duplicate_paths
) checks ORDER BY label;