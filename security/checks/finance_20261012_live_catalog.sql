-- INMOJCO #104 / 2026-11-03. Read-only finance catalog inventory.
-- This is a structural preflight, not proof of identical SQL body, indexes,
-- grants beyond listed controls, historical ordering, or safe migration repair.
-- Never change a live schema or migration ledger on the basis of this report.
WITH expected(kind, relation_name, object_name) AS (
  VALUES
    ('rls','owner_statement_deductions',''),
    ('rls','rent_receipts',''),
    ('rls','leases',''),
    ('rls','rent_payments',''),
    ('rls','owner_statements',''),
    ('constraint','owner_statements','owner_statements_org_id_key'),
    ('constraint','owner_statement_deductions','owner_deductions_statement_same_tenant_fk'),
    ('constraint','owner_statement_deductions','owner_deductions_void_reason_check'),
    ('constraint','leases','leases_org_id_unique'),
    ('constraint','rent_payments','rent_payments_org_id_unique'),
    ('constraint','rent_payments','rent_payments_unique_period'),
    ('constraint','rent_payments','rent_payments_lease_same_org_fk'),
    ('constraint','owner_statements','owner_statement_unique_per_month'),
    ('constraint','owner_statements','owner_statement_lease_same_org_fk'),
    ('constraint','properties','financial_properties_tenant_id_unique'),
    ('constraint','contacts','financial_contacts_tenant_id_unique'),
    ('constraint','property_owners','financial_property_owners_tenant_id_unique'),
    ('constraint','owner_statements','owner_statement_owner_same_tenant_fk'),
    ('constraint','leases','leases_property_same_tenant_fk'),
    ('constraint','leases','leases_tenant_same_tenant_fk'),
    ('constraint','leases','leases_owner_same_tenant_fk'),
    ('constraint','leases','leases_financial_amount_valid'),
    ('constraint','leases','leases_financial_dates_valid'),
    ('constraint','rent_payments','rent_payment_financial_amounts_valid'),
    ('constraint','rent_payments','rent_payment_month_valid'),
    ('constraint','owner_statements','owner_statement_financial_amounts_valid'),
    ('constraint','owner_statements','owner_statement_month_valid'),
    ('constraint','owner_statement_deductions','owner_deduction_finite_amount'),
    ('constraint','rent_receipts','rent_receipt_finite_amount'),
    ('policy','owner_statement_deductions','owner_deductions_view'),
    ('policy','owner_statement_deductions','owner_deductions_insert'),
    ('policy','owner_statement_deductions','owner_deductions_update_status'),
    ('policy','rent_receipts','rent_receipts_view'),
    ('policy','leases','leases_financial_view'),
    ('policy','leases','leases_financial_insert'),
    ('policy','leases','leases_financial_update'),
    ('policy','owner_statements','owner_statement_financial_view'),
    ('policy','rent_payments','rent_payments_financial_view'),
    ('trigger','owner_statement_deductions','owner_statement_deductions_guard'),
    ('trigger','owner_statement_deductions','aaa_owner_deductions_server_timestamps'),
    ('function','definer','guard_owner_statement_deduction_change()'),
    ('function','invoker','normalize_owner_deduction_audit_fields()'),
    ('function','definer','create_tenant_rent_period(uuid,uuid,date)'),
    ('function','definer','record_tenant_rent_receipt(uuid,uuid,numeric,text,text,uuid)'),
    ('function','definer','create_owner_draft_statement(uuid,uuid,date,numeric,numeric)'),
    ('function','definer','reconcile_owner_draft_statement(uuid,uuid)')
), catalog AS (
  SELECT e.*,
         cls.oid AS relid, cls.relrowsecurity AS rls_enabled,
         c.oid AS constraint_oid, c.convalidated,
         pol.oid AS policy_oid, pol.polpermissive,
         pg_get_expr(pol.polwithcheck,pol.polrelid) AS policy_check,
         tg.oid AS trigger_oid, tg.tgenabled,
         fn.oid AS function_oid, fn.prosecdef, fn.proconfig
  FROM expected e
  LEFT JOIN pg_class cls ON cls.oid=to_regclass('public.' || e.relation_name)
    AND e.kind <> 'function'
  LEFT JOIN pg_constraint c ON e.kind='constraint'
    AND c.conrelid=cls.oid AND c.conname=e.object_name
  LEFT JOIN pg_policy pol ON e.kind='policy'
    AND pol.polrelid=cls.oid AND pol.polname=e.object_name
  LEFT JOIN pg_trigger tg ON e.kind='trigger'
    AND tg.tgrelid=cls.oid AND tg.tgname=e.object_name
    AND NOT tg.tgisinternal
  LEFT JOIN pg_proc fn ON e.kind='function'
    AND fn.oid=to_regprocedure('public.' || e.object_name)
)
SELECT kind, CASE WHEN kind='function' THEN object_name
                  WHEN kind='rls' THEN relation_name
                  ELSE relation_name || '.' || object_name END AS identifier,
       CASE
         WHEN kind='rls' AND relid IS NULL THEN 'MISSING_TABLE'
         WHEN kind='rls' AND rls_enabled IS NOT TRUE THEN 'RLS_DISABLED'
         WHEN kind='constraint' AND constraint_oid IS NULL THEN 'MISSING_CONSTRAINT'
         WHEN kind='constraint' AND convalidated IS NOT TRUE THEN 'NOT_VALIDATED'
         WHEN kind='policy' AND policy_oid IS NULL THEN 'MISSING_POLICY'
         WHEN kind='policy' AND object_name IN
           ('leases_financial_view','leases_financial_insert','leases_financial_update',
            'owner_statement_financial_view','rent_payments_financial_view')
           AND polpermissive IS NOT FALSE THEN 'NOT_RESTRICTIVE'
         WHEN kind='policy' AND object_name='leases_financial_insert'
           AND (policy_check IS NULL OR position('DRAFT' in policy_check)=0)
           THEN 'DRAFT_CHECK_MISSING'
         WHEN kind='trigger' AND trigger_oid IS NULL THEN 'MISSING_TRIGGER'
         WHEN kind='trigger' AND tgenabled NOT IN ('O','A') THEN 'TRIGGER_DISABLED'
         WHEN kind='function' AND function_oid IS NULL THEN 'MISSING_FUNCTION'
         WHEN kind='function' AND (prosecdef IS DISTINCT FROM (relation_name='definer'))
           THEN 'WRONG_FUNCTION_SECURITY'
         WHEN kind='function' AND NOT EXISTS (
           SELECT 1 FROM unnest(coalesce(proconfig,ARRAY[]::text[])) cfg
             WHERE cfg LIKE 'search_path=%pg_catalog%')
           THEN 'SEARCH_PATH_UNPINNED'
         WHEN kind='function' AND has_function_privilege('anon',function_oid,'EXECUTE')
           THEN 'ANON_FUNCTION_EXECUTE'
         ELSE 'OK'
       END AS finding
FROM catalog
ORDER BY kind,identifier;
