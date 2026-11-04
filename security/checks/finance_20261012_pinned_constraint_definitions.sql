-- #104: PostgreSQL 17 full-definition checksums for finance constraints.
-- Pinned from READ-ONLY production pg_get_constraintdef(oid, true) 03-Nov-2026.
-- A matching name alone is NOT adequate: detect weakened checks / wrong FKs.
-- This is a one-part preflight, NOT proof of complete SQL/migration equivalence.
-- Output includes only schema identifiers and status, never tenant records.
WITH expected(rel,con,expected_hash,expected_type) AS (VALUES
  ('contacts','financial_contacts_tenant_id_unique','f443f6683833a89a1b10ce7aab8e79f7','u'),
  ('leases','leases_financial_amount_valid','96ebe1864206dfcb707a249df8fe1fe3','c'),
  ('leases','leases_financial_dates_valid','f2ab29018518d09d7ff4fc500b5d9ef7','c'),
  ('leases','leases_org_id_unique','f443f6683833a89a1b10ce7aab8e79f7','u'),
  ('leases','leases_owner_same_tenant_fk','46a18db2d24231e7a30c315fc83fa1d5','f'),
  ('leases','leases_property_same_tenant_fk','4d0c71b70a6da473b6e3e929ccfe9d12','f'),
  ('leases','leases_tenant_same_tenant_fk','ce8e3e6f4dc317e1286f590cd51e5cf6','f'),
  ('owner_statement_deductions','owner_deduction_finite_amount','3ff719123ad43b082d83978db2f5a0c9','c'),
  ('owner_statement_deductions','owner_deductions_statement_same_tenant_fk','d33f60370907dd0aa37e1cd14346144a','f'),
  ('owner_statement_deductions','owner_deductions_void_reason_check','0900ead86204bb5558393a63a1895ac9','c'),
  ('owner_statements','owner_statement_financial_amounts_valid','18d0c927364ed6a238c1d0d542fccd8a','c'),
  ('owner_statements','owner_statement_lease_same_org_fk','1637e62e2184d4a2c00ac5426da3098b','f'),
  ('owner_statements','owner_statement_month_valid','bd8358a93b7c5401671bb062a575cb67','c'),
  ('owner_statements','owner_statement_owner_same_tenant_fk','46a18db2d24231e7a30c315fc83fa1d5','f'),
  ('owner_statements','owner_statement_unique_per_month','dba226de1ae830bcbf40ce0f975807a9','u'),
  ('owner_statements','owner_statements_org_id_key','f443f6683833a89a1b10ce7aab8e79f7','u'),
  ('properties','financial_properties_tenant_id_unique','f443f6683833a89a1b10ce7aab8e79f7','u'),
  ('property_owners','financial_property_owners_tenant_id_unique','f443f6683833a89a1b10ce7aab8e79f7','u'),
  ('rent_payments','rent_payment_financial_amounts_valid','bf31d1b030e94a34e72655dee81a7977','c'),
  ('rent_payments','rent_payment_month_valid','bd8358a93b7c5401671bb062a575cb67','c'),
  ('rent_payments','rent_payments_lease_same_org_fk','1637e62e2184d4a2c00ac5426da3098b','f'),
  ('rent_payments','rent_payments_org_id_unique','f443f6683833a89a1b10ce7aab8e79f7','u'),
  ('rent_payments','rent_payments_unique_period','d15ebefb0967bb13d34cd39c00c0717d','u'),
  ('rent_receipts','rent_receipt_finite_amount','3ff719123ad43b082d83978db2f5a0c9','c')
), actual AS (
 SELECT e.*,c.oid AS constraint_oid,c.contype, c.convalidated,c.condeferrable,
        md5(pg_get_constraintdef(c.oid,true)) AS definition_hash
 FROM expected e
 LEFT JOIN pg_class tab ON tab.oid=to_regclass('public.'||e.rel)
 LEFT JOIN pg_constraint c ON c.conrelid=tab.oid AND c.conname=e.con
)
SELECT rel||'.'||con AS identifier,
 CASE
  WHEN constraint_oid IS NULL THEN 'MISSING_CONSTRAINT'
  WHEN convalidated IS NOT TRUE THEN 'NOT_VALIDATED'
  WHEN condeferrable IS TRUE THEN 'UNEXPECTED_DEFERRABLE'
  WHEN contype IS DISTINCT FROM expected_type THEN 'WRONG_CONSTRAINT_KIND'
  WHEN definition_hash IS DISTINCT FROM expected_hash THEN 'DEFINITION_DRIFT'
  ELSE 'OK'
 END AS finding
FROM actual ORDER BY identifier;
