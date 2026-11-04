-- #104 - READ-ONLY catalog contract for portal-aware restrictive financial RLS.
-- Pg17 policy expression fingerprints are pinned from production on 2026-11-03.
-- Includes per-person tenant links, financial status checks and staff bypass.
-- Never use this as authorization for a migration repair, db push, or a rollback.
-- All output is schema-level; no tenant data or identifiers are returned.
WITH expected(relation_name, policy_name, expected_md5) AS (
 VALUES
  ('leases','leases_financial_view','ea412a8206710ac9c4f95952abf6576a'),
  ('owner_statements','owner_statement_financial_view','8a01b76618aab663b4fe604a042040f0'),
  ('rent_payments','rent_payments_financial_view','167cc9fc71b02a7ac9e1cbc6c1b4f8af')
), found AS (
 SELECT e.*,cl.oid AS relation_oid,cl.relrowsecurity,
        p.oid AS policy_oid,p.polcmd,p.polpermissive,p.polroles,
        pg_get_expr(p.polqual,p.polrelid) AS expression
 FROM expected e
 LEFT JOIN pg_class cl ON cl.oid=to_regclass('public.'||e.relation_name)
 LEFT JOIN pg_policy p ON p.polrelid=cl.oid AND p.polname=e.policy_name
)
SELECT relation_name||'.'||policy_name AS identifier,
 CASE
  WHEN relation_oid IS NULL THEN 'TABLE_MISSING'
  WHEN relrowsecurity IS NOT TRUE THEN 'RLS_DISABLED'
  WHEN policy_oid IS NULL THEN 'POLICY_MISSING'
  WHEN polcmd<>'r' OR polpermissive IS NOT FALSE THEN 'NOT_RESTRICTIVE_SELECT'
  WHEN cardinality(polroles)<>1 OR polroles[1] IS DISTINCT FROM
    (SELECT oid FROM pg_roles WHERE rolname='authenticated') THEN 'WRONG_POLICY_ROLE'
  WHEN md5(expression) IS DISTINCT FROM expected_md5 THEN 'POLICY_BODY_DRIFT'
  ELSE 'OK'
 END AS finding
FROM found ORDER BY identifier;
