-- #104: Read-only security contract for the five historic finance files.
-- Includes effective API role grants and RLS policy/SECURITY DEFINER semantics.
-- This is NOT a SQL-equivalence certificate or authorization for db push/repair.
-- Output contains only identifiers and findings, never customer records.
WITH expected_tables(rel, auth_insert, auth_update) AS (
  VALUES
  ('leases',true,true),
  ('owner_statement_deductions',true,true),
  ('owner_statements',false,false),
  ('rent_payments',false,false),
  ('rent_receipts',false,false)
), tables_check AS (
  SELECT 'table_acl'::text AS kind, e.rel::text AS identifier,
    CASE
      WHEN cls.oid IS NULL THEN 'MISSING_TABLE'
      WHEN cls.relrowsecurity IS NOT TRUE THEN 'RLS_DISABLED'
      WHEN has_table_privilege('anon',cls.oid,'SELECT') OR
           has_table_privilege('anon',cls.oid,'INSERT') OR
           has_table_privilege('anon',cls.oid,'UPDATE') OR
           has_table_privilege('anon',cls.oid,'DELETE') THEN 'ANON_TABLE_ACCESS'
      WHEN has_table_privilege('authenticated',cls.oid,'DELETE')
        THEN 'DIRECT_DELETE_ENABLED'
      WHEN NOT has_table_privilege('authenticated',cls.oid,'SELECT')
        THEN 'AUTH_SELECT_MISSING'
      WHEN has_table_privilege('authenticated',cls.oid,'INSERT')
             IS DISTINCT FROM e.auth_insert
        THEN 'WRONG_INSERT_GRANT'
      WHEN has_table_privilege('authenticated',cls.oid,'UPDATE')
             IS DISTINCT FROM e.auth_update
        THEN 'WRONG_UPDATE_GRANT'
      ELSE 'OK' END AS finding
  FROM expected_tables e
  LEFT JOIN pg_class cls ON cls.oid=to_regclass('public.'||e.rel)
), expected_functions(sig,is_definer,auth_exec,requires_permission,requires_lock) AS (
  VALUES
  ('guard_owner_statement_deduction_change()',true,false,true,true),
  ('normalize_owner_deduction_audit_fields()',false,false,false,false),
  ('create_tenant_rent_period(uuid,uuid,date)',true,true,true,true),
  ('record_tenant_rent_receipt(uuid,uuid,numeric,text,text,uuid)',true,true,true,true),
  ('create_owner_draft_statement(uuid,uuid,date,numeric,numeric)',true,true,true,true),
  ('reconcile_owner_draft_statement(uuid,uuid)',true,true,true,true)
), functions_check AS (
  SELECT 'function_acl'::text AS kind, e.sig::text AS identifier,
    CASE
      WHEN fn.oid IS NULL THEN 'MISSING_FUNCTION'
      WHEN fn.prosecdef IS DISTINCT FROM e.is_definer THEN 'WRONG_SECURITY_MODE'
      WHEN has_function_privilege('anon',fn.oid,'EXECUTE') THEN 'ANON_EXECUTE'
      WHEN has_function_privilege('authenticated',fn.oid,'EXECUTE')
             IS DISTINCT FROM e.auth_exec THEN 'WRONG_STAFF_EXECUTE'
      WHEN NOT EXISTS (SELECT 1 FROM unnest(coalesce(fn.proconfig,ARRAY[]::text[])) cfg
         WHERE cfg LIKE 'search_path=pg_catalog%') THEN 'UNPINNED_SEARCH_PATH'
      WHEN e.requires_permission AND
        (position('auth.uid()' IN fn.prosrc)=0 OR
         position('has_org_permission' IN fn.prosrc)=0)
        THEN 'MISSING_PERMISSION_GUARD_SOURCE'
      WHEN e.requires_lock AND position('FOR UPDATE' IN upper(fn.prosrc))=0
        THEN 'MISSING_LOCK_SOURCE'
      WHEN NOT e.is_definer AND
         position('statement_timestamp()' IN fn.prosrc)=0
        THEN 'AUDIT_TIMESTAMP_NOT_SERVER_OWNED'
      ELSE 'OK' END AS finding
  FROM expected_functions e
  LEFT JOIN pg_proc fn ON fn.oid=to_regprocedure('public.'||e.sig)
), expected_policies(rel,name,command,restrictive,check_required) AS (
  VALUES
  ('leases','leases_financial_view','r',true,false),
  ('leases','leases_financial_insert','a',true,true),
  ('leases','leases_financial_update','w',true,true),
  ('owner_statements','owner_statement_financial_view','r',true,false),
  ('rent_payments','rent_payments_financial_view','r',true,false),
  ('owner_statement_deductions','owner_deductions_view','r',false,false),
  ('owner_statement_deductions','owner_deductions_insert','a',false,true),
  ('owner_statement_deductions','owner_deductions_update_status','w',false,true),
  ('rent_receipts','rent_receipts_view','r',false,false)
), policies_check AS (
 SELECT 'policy_acl'::text AS kind, (e.rel||'.'||e.name)::text AS identifier,
   CASE
    WHEN pol.oid IS NULL THEN 'MISSING_POLICY'
    WHEN pol.polcmd IS DISTINCT FROM e.command THEN 'WRONG_POLICY_COMMAND'
    WHEN (NOT pol.polpermissive) IS DISTINCT FROM e.restrictive
      THEN 'WRONG_RESTRICTIVE_MODE'
    WHEN cardinality(pol.polroles)<>1 OR pol.polroles[1] IS DISTINCT FROM
      (SELECT oid FROM pg_roles WHERE rolname='authenticated')
      THEN 'POLICY_NOT_STAFF_SCOPED'
    WHEN e.check_required AND pol.polwithcheck IS NULL THEN 'NO_WITH_CHECK'
    WHEN position('has_org_permission' IN
      coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||' '||
      coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''))=0
      THEN 'NO_TENANT_PERMISSION_GUARD'
    WHEN e.name='leases_financial_insert' AND position('DRAFT' IN
      coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''))=0
      THEN 'DRAFT_ONLY_CHECK_MISSING'
    ELSE 'OK' END AS finding
 FROM expected_policies e
 LEFT JOIN pg_class cls ON cls.oid=to_regclass('public.'||e.rel)
 LEFT JOIN pg_policy pol ON pol.polrelid=cls.oid AND pol.polname=e.name
)
SELECT kind,identifier,finding FROM tables_check
UNION ALL SELECT kind,identifier,finding FROM functions_check
UNION ALL SELECT kind,identifier,finding FROM policies_check
ORDER BY kind,identifier;
