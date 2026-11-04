-- INMOJCO #104 — SELECT-only baseline-compatibility check for authentic
-- applied 20261005153559 / 0026_rental_management_core (47 original columns).
-- Source checked directly in live supabase_migrations.schema_migrations.
-- PostgreSQL 17 catalogue METADATA only: no tenant rows, no DDL/DML.
-- Original indexes/policies surviving does NOT prove unchanged definition or
-- complete historical replay. Later columns/guardrails are expected.
WITH original_columns(table_name,column_name,original_type,original_not_null) AS (
  VALUES
    ('leases','id','uuid',true),
    ('leases','organization_id','uuid',true),
    ('leases','property_id','uuid',true),
    ('leases','owner_id','uuid',false),
    ('leases','tenant_id','uuid',false),
    ('leases','contract_number','text',false),
    ('leases','start_date','date',true),
    ('leases','end_date','date',false),
    ('leases','monthly_rent','numeric(16,2)',true),
    ('leases','payment_day','integer',false),
    ('leases','adjustment_type','text',false),
    ('leases','adjustment_percentage','numeric(8,2)',false),
    ('leases','status','text',true),
    ('leases','created_at','timestamp with time zone',true),
    ('leases','updated_at','timestamp with time zone',true),
    ('rent_payments','id','uuid',true),
    ('rent_payments','organization_id','uuid',true),
    ('rent_payments','lease_id','uuid',true),
    ('rent_payments','period_month','date',true),
    ('rent_payments','expected_amount','numeric(16,2)',true),
    ('rent_payments','paid_amount','numeric(16,2)',true),
    ('rent_payments','paid_at','timestamp with time zone',false),
    ('rent_payments','status','text',true),
    ('rent_payments','notes','text',false),
    ('rent_payments','created_at','timestamp with time zone',true),
    ('owner_statements','id','uuid',true),
    ('owner_statements','organization_id','uuid',true),
    ('owner_statements','lease_id','uuid',true),
    ('owner_statements','owner_id','uuid',false),
    ('owner_statements','period_month','date',true),
    ('owner_statements','gross_income','numeric(16,2)',true),
    ('owner_statements','commission_amount','numeric(16,2)',true),
    ('owner_statements','tax_amount','numeric(16,2)',true),
    ('owner_statements','other_deductions','numeric(16,2)',true),
    ('owner_statements','net_amount','numeric(16,2)',true),
    ('owner_statements','status','text',true),
    ('owner_statements','created_at','timestamp with time zone',true),
    ('maintenance_requests','id','uuid',true),
    ('maintenance_requests','organization_id','uuid',true),
    ('maintenance_requests','property_id','uuid',true),
    ('maintenance_requests','reported_by','uuid',false),
    ('maintenance_requests','title','text',true),
    ('maintenance_requests','description','text',false),
    ('maintenance_requests','estimated_cost','numeric(16,2)',false),
    ('maintenance_requests','status','text',true),
    ('maintenance_requests','created_at','timestamp with time zone',true),
    ('maintenance_requests','updated_at','timestamp with time zone',true)
), original_objects(table_name,initial_index,initial_policy) AS (
  VALUES
    ('leases','idx_leases_org','leases_org_access'),
    ('rent_payments','idx_rent_payments_lease','rent_payments_org_access'),
    ('owner_statements','idx_owner_statements_owner','owner_statements_org_access'),
    ('maintenance_requests','idx_maintenance_property','maintenance_org_access')
), tables AS (
 SELECT o.*, c.oid, c.relrowsecurity,
        pg_get_userbyid(c.relowner) AS owner
 FROM original_objects o
 LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||o.table_name)
), shape AS (
 SELECT t.table_name,t.oid,t.owner,
   coalesce(t.relrowsecurity,false) AS rls_enabled,
   (SELECT count(*) FROM original_columns o WHERE o.table_name=t.table_name)
     AS original_column_count,
   (SELECT count(*) FROM original_columns o
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0
          AND NOT a.attisdropped AND a.attname=o.column_name
      WHERE o.table_name=t.table_name
        AND format_type(a.atttypid,a.atttypmod)=o.original_type
        AND a.attnotnull=o.original_not_null) AS matching_original_columns,
   (SELECT count(*) FROM pg_attribute a
      WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped
      AND NOT EXISTS(SELECT 1 FROM original_columns o
         WHERE o.table_name=t.table_name AND o.column_name=a.attname))
     AS added_columns_since_original,
   EXISTS(SELECT 1 FROM pg_index idx
       JOIN pg_class ci ON ci.oid=idx.indexrelid
       WHERE idx.indrelid=t.oid AND ci.relname=t.initial_index
           AND idx.indisvalid) AS original_index_present_valid,
   EXISTS(SELECT 1 FROM pg_policy pol
       WHERE pol.polrelid=t.oid AND pol.polname=t.initial_policy
         AND pol.polcmd='*'
         AND 'authenticated'::regrole::oid=ANY(pol.polroles))
       AS original_all_authenticated_policy_present
 FROM tables t
)
SELECT table_name,oid IS NOT NULL AS table_present,owner,rls_enabled,
 original_column_count,matching_original_columns,added_columns_since_original,
 original_index_present_valid,original_all_authenticated_policy_present,
 CASE WHEN oid IS NOT NULL AND rls_enabled
     AND matching_original_columns=original_column_count
     AND original_index_present_valid AND original_all_authenticated_policy_present
   THEN 'BASELINE_COMPATIBLE' ELSE 'DRIFT' END AS verdict
FROM shape ORDER BY table_name;
