-- #104: exact finance write/read policy definitions on PostgreSQL 17.
-- Pinned from production catalog on 2026-11-03 with READ-ONLY SQL.
-- DO NOT use this report to authorize a migration repair or db push.
-- NOTE: owner_deductions_insert has a known later improvement that wraps
-- auth.uid() in a SELECT; the historic five-file fixture is expected to
-- report POLICY_BODY_DRIFT for this one policy. Never weaken it to match.
WITH expected(relation_name,policy_name,command,restrictive,definition_md5) AS (VALUES
 ('leases','leases_financial_insert','a',true,'145e7d891764a32f8248038df75d5a7b'),
 ('leases','leases_financial_update','w',true,'0b86e10fe9fd8bc060c2185bd67af438'),
 ('owner_statement_deductions','owner_deductions_insert','a',false,'1f9416f712bdf58ad7e2a4266e871934'),
 ('owner_statement_deductions','owner_deductions_update_status','w',false,'4923118447525c8ca9dd86fe09fd8409'),
 ('owner_statement_deductions','owner_deductions_view','r',false,'2118d71fe714cc5c343dd61b167a4c66'),
 ('rent_receipts','rent_receipts_view','r',false,'1a0f1ffed64bc0eb2349cf63e071016b')
), found AS (
 SELECT e.*,cl.oid AS relid,cl.relrowsecurity,p.oid AS policy_oid,
        p.polcmd,p.polpermissive,p.polroles,
        md5(coalesce(pg_get_expr(p.polqual,p.polrelid),'')||chr(10)||
            coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')) AS current_hash
 FROM expected e
 LEFT JOIN pg_class cl ON cl.oid=to_regclass('public.'||e.relation_name)
 LEFT JOIN pg_policy p ON p.polrelid=cl.oid AND p.polname=e.policy_name
)
SELECT relation_name||'.'||policy_name AS identifier,
 CASE
  WHEN relid IS NULL THEN 'MISSING_TABLE'
  WHEN relrowsecurity IS NOT TRUE THEN 'RLS_DISABLED'
  WHEN policy_oid IS NULL THEN 'MISSING_POLICY'
  WHEN polcmd IS DISTINCT FROM command OR
       (NOT polpermissive) IS DISTINCT FROM restrictive
    THEN 'POLICY_MODE_DRIFT'
  WHEN cardinality(polroles)<>1 OR polroles[1] IS DISTINCT FROM
    (SELECT oid FROM pg_roles WHERE rolname='authenticated')
    THEN 'POLICY_ROLE_DRIFT'
  WHEN current_hash IS DISTINCT FROM definition_md5 THEN 'POLICY_BODY_DRIFT'
  ELSE 'OK'
 END AS finding
FROM found ORDER BY identifier;
