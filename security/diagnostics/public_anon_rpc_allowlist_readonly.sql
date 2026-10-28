-- INMOJCO: read-only audit of the exact anonymous SECURITY DEFINER RPC
-- allowlist. New anonymous privileged functions should be explicitly reviewed,
-- not silently accepted. This does not execute mutating RPCs.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH approved(function_oid) AS (
 VALUES
 (to_regprocedure('public.get_public_property_intake_site(text)')),
 (to_regprocedure('public.submit_property_consignment(text,uuid,jsonb)')),
 (to_regprocedure('public.submit_public_website_lead(text,text,text,text,text,text,boolean,text)')),
 (to_regprocedure('public.tenant_public_catalog(text)'))
), exposed AS (
 SELECT p.oid, p.proname,
   p.prosecdef,
   coalesce('search_path=""'=ANY(p.proconfig),false) AS search_path_isolated
 FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef
   AND has_function_privilege('anon',p.oid,'EXECUTE')
)
SELECT (SELECT count(*) FROM approved) AS expected_public_rpcs,
       (SELECT count(*) FROM exposed) AS exposed_security_definer_rpcs,
       (SELECT count(*) FROM approved a WHERE a.function_oid IS NULL
         OR NOT EXISTS (SELECT 1 FROM exposed x WHERE x.oid=a.function_oid)) AS approved_missing_or_inaccessible,
       (SELECT count(*) FROM exposed e WHERE e.oid NOT IN
         (SELECT a.function_oid FROM approved a WHERE a.function_oid IS NOT NULL)) AS unexpected_privileged_rpcs,
       (SELECT count(*) FROM exposed e WHERE NOT e.search_path_isolated) AS privileged_rpcs_without_isolated_search_path;
COMMIT;
