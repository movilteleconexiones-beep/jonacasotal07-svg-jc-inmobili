-- INMOJCO #104. SELECT-only production catalog preflight, snapshot 2026-11-06.
-- All hashes are metadata fingerprints of currently DEPLOYED definitions.
-- They are not proof that the 3 missing local migration versions were applied.
-- NEVER change the local migration ledger based on this check.
WITH expected_functions(identifier, expected_sha) AS (
 VALUES
 ('private.can_read_portal_property(uuid,uuid)',
  '99043c5260c8396e41f115576b87659646310d4a78057a2b9617a80e001b8609'),
 ('public.has_portal_property(uuid)',
  'cff460f7627973317147be83d814527fb7792a03f7d0dabb36ab7fedf4688555')
), functions AS (
 SELECT e.identifier, e.expected_sha,p.oid,p.prosecdef,p.provolatile,p.proconfig,
    CASE WHEN p.oid IS NULL THEN NULL
         ELSE encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')
    END AS body_sha
 FROM expected_functions e LEFT JOIN pg_proc p
   ON p.oid=to_regprocedure(e.identifier)
), expected_policies(relation_name,policy_name,predicate_sha) AS (
 VALUES
 ('public.properties','properties_select_portal_related',
  '4084df13a16e475663d65546c5d5876fb15676fbd8fa3d4ea0fdc3ce934b5e87'),
 ('public.property_ownerships','ownerships_select_portal_owner',
  'ed79d03c3fe4422ca8c3115417667e2abf29ec24e414760207db8e604e0ad3e0')
), policies AS (
 SELECT e.*,c.oid AS relation_oid,c.relrowsecurity,
   p.polcmd,p.polpermissive,p.polroles,p.polwithcheck,
   CASE WHEN p.oid IS NULL THEN NULL
        ELSE encode(sha256(convert_to(pg_get_expr(p.polqual,p.polrelid),'UTF8')),'hex')
   END AS current_sha
 FROM expected_policies e
 LEFT JOIN pg_class c ON c.oid=to_regclass(e.relation_name)
 LEFT JOIN pg_policy p ON p.polrelid=c.oid AND p.polname=e.policy_name
), expected_plans(code,period,price,currency,max_users,max_properties,perms) AS (
 VALUES
 ('BASIC','MONTHLY',129900::numeric,'COP',5,200,47),
 ('PRO','MONTHLY',299900::numeric,'COP',25,2000,47),
 ('LIFETIME','ONE_TIME',0::numeric,'USD',NULL::integer,NULL::integer,0),
 ('ENTERPRISE','CUSTOM',0::numeric,'USD',NULL::integer,NULL::integer,0)
), commercial AS (
 SELECT e.*,p.id,p.billing_cycle,p.price AS actual_price,p.currency AS actual_currency,
 p.max_users AS actual_users,p.max_properties AS actual_properties,p.active,
 (SELECT count(*) FROM public.plan_features f WHERE f.plan_id=p.id
    AND f.enabled AND f.feature_key LIKE 'permission:%') AS actual_perms
 FROM expected_plans e LEFT JOIN public.plans p ON p.code=e.code
)
SELECT 'RLS_FUNCTION' AS component,f.identifier,
 CASE WHEN f.oid IS NOT NULL
      AND f.prosecdef AND f.provolatile='s'
      AND f.proconfig=ARRAY['search_path=""']::text[]
      AND f.body_sha=f.expected_sha
      AND has_function_privilege('anon',f.oid,'EXECUTE')=false
      AND has_function_privilege('authenticated',f.oid,'EXECUTE')=true
   THEN 'OK' ELSE 'DRIFT' END AS finding
FROM functions f
UNION ALL
SELECT 'RLS_POLICY',p.relation_name||'.'||p.policy_name,
 CASE WHEN p.relation_oid IS NOT NULL AND p.relrowsecurity
      AND p.polcmd='r' AND p.polpermissive
      AND p.polroles=ARRAY['authenticated'::regrole::oid]
      AND p.polwithcheck IS NULL AND p.current_sha=p.predicate_sha
   THEN 'OK' ELSE 'DRIFT' END
FROM policies p
UNION ALL
SELECT 'COMMERCIAL_PLAN',c.code,
 CASE WHEN c.id IS NOT NULL AND c.active
      AND c.billing_cycle=c.period
      AND c.actual_price IS NOT DISTINCT FROM c.price
      AND c.actual_currency=c.currency
      AND c.actual_users IS NOT DISTINCT FROM c.max_users
      AND c.actual_properties IS NOT DISTINCT FROM c.max_properties
      AND c.actual_perms=c.perms
   THEN 'OK' ELSE 'DRIFT' END
FROM commercial c
UNION ALL
SELECT 'COMMERCIAL_CATALOG','annual-plans-unconfigured',
 CASE WHEN NOT EXISTS (
  SELECT 1 FROM public.plans
  WHERE code IN ('BASIC_ANNUAL','PRO_ANNUAL','ENTERPRISE_ANNUAL')
 ) THEN 'OK' ELSE 'DRIFT' END
UNION ALL
SELECT 'MIGRATION_LEDGER','three-unmatched-versions-absent',
 CASE WHEN (SELECT count(*) FROM supabase_migrations.schema_migrations)=99
      AND NOT EXISTS (
        SELECT 1 FROM supabase_migrations.schema_migrations
        WHERE version IN ('20261010212630','20261010214633','20261010222700')
      ) THEN 'OK' ELSE 'DRIFT' END
ORDER BY component,identifier;
