-- INMOJCO #104 — live READ-ONLY reconciliation of object identities extracted
-- from applied 20261012070133/audited_rent_receipts_owner_deductions_finance_permissions.
-- The authentic 28,005-character SQL body remains ONLY in Supabase ledger.
-- 2 tables, 5 functions, 9 policies, 1 trigger, 2 indexes: 19 objects.
-- Presence here is NOT proof of identical definitions, chronology, or permissions.
-- No tenant rows, no Auth content, no DDL/DML, no migration ledger writes.
WITH expected(kind,name,parent) AS (
 VALUES
 ('table','owner_statement_deductions','owner_statement_deductions'),
 ('table','rent_receipts','rent_receipts'),
 ('function','guard_owner_statement_deduction_change',''),
 ('function','create_tenant_rent_period',''),
 ('function','record_tenant_rent_receipt',''),
 ('function','create_owner_draft_statement',''),
 ('function','reconcile_owner_draft_statement',''),
 ('policy','owner_deductions_view','owner_statement_deductions'),
 ('policy','owner_deductions_insert','owner_statement_deductions'),
 ('policy','owner_deductions_update_status','owner_statement_deductions'),
 ('policy','rent_receipts_view','rent_receipts'),
 ('policy','leases_financial_view','leases'),
 ('policy','leases_financial_insert','leases'),
 ('policy','leases_financial_update','leases'),
 ('policy','owner_statement_financial_view','owner_statements'),
 ('policy','rent_payments_financial_view','rent_payments'),
 ('trigger','owner_statement_deductions_guard','owner_statement_deductions'),
 ('index','owner_deductions_statement_created_idx','owner_statement_deductions'),
 ('index','rent_receipts_period_idx','rent_receipts')
)
SELECT kind,name,parent,
CASE kind
 WHEN 'table' THEN to_regclass('public.'||name) IS NOT NULL
 WHEN 'function' THEN EXISTS(SELECT 1 FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname=expected.name AND p.prokind='f')
 WHEN 'policy' THEN EXISTS(SELECT 1 FROM pg_policy pol
   WHERE pol.polrelid=to_regclass('public.'||expected.parent)
     AND pol.polname=expected.name)
 WHEN 'trigger' THEN EXISTS(SELECT 1 FROM pg_trigger t
   WHERE t.tgrelid=to_regclass('public.'||expected.parent)
     AND t.tgname=expected.name AND NOT t.tgisinternal AND t.tgenabled<>'D')
 WHEN 'index' THEN EXISTS(SELECT 1 FROM pg_index i
   JOIN pg_class c ON c.oid=i.indexrelid
   WHERE i.indrelid=to_regclass('public.'||expected.parent)
     AND c.relname=expected.name AND i.indisvalid)
 END AS exists_now
FROM expected ORDER BY kind,parent,name;
