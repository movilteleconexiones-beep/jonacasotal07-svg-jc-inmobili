-- INMOJCO #104 — SELECT-only baseline-compatibility check for authentic
-- applied 20261005153559 / 0026_rental_management_core (47 original columns).
-- Source checked directly in live supabase_migrations.schema_migrations.
-- PostgreSQL 17 catalogue METADATA only: no tenant rows, no DDL/DML.
-- Pin current staff guards, full original index definitions, and exact
-- approved later portal SELECT policies. Unknown or altered permissive
-- access returns DRIFT. Historical replay remains NO-GO.
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
), approved_portal_policies(table_name,policy_name,using_sha256) AS (
  -- Production 2026-11-05, metadata only. Later approved external SELECTs.
  -- Hashes are of pg_get_expr(polqual,polrelid), not the full CREATE POLICY.
  VALUES
    ('leases','leases_owner_portal_select','8edc2a7a4a9fe194979395b5fda9012a62d778604ee87553abbb7e2f0a5f876d'),
    ('leases','leases_tenant_portal_select','1c83a68d500060fa11e84286173c954e3fdf606ac088d423efd262d3a72f99b6'),
    ('owner_statements','owner_statements_external_issued','6f9fa81441bd18f3e1cff94e1eadcd888cfb6810504f66bc0300058ede6cac84'),
    ('rent_payments','rent_payments_external_personal','3cbbecfd27ecc63fc035c57d390f3a6fd446f01150ad9845d09d892cc925ef12')
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
   EXISTS(SELECT 1 FROM pg_index idx JOIN pg_class ci ON ci.oid=idx.indexrelid
       WHERE idx.indrelid=t.oid AND ci.relname=t.initial_index
         AND idx.indisvalid AND idx.indisready
         AND pg_get_indexdef(idx.indexrelid) = CASE t.table_name
           WHEN 'leases' THEN 'CREATE INDEX idx_leases_org ON public.leases USING btree (organization_id)'
           WHEN 'rent_payments' THEN 'CREATE INDEX idx_rent_payments_lease ON public.rent_payments USING btree (lease_id)'
           WHEN 'owner_statements' THEN 'CREATE INDEX idx_owner_statements_owner ON public.owner_statements USING btree (owner_id)'
           WHEN 'maintenance_requests' THEN 'CREATE INDEX idx_maintenance_property ON public.maintenance_requests USING btree (property_id)'
         END) AS original_index_definition_intact,
   EXISTS(SELECT 1 FROM pg_policy pol
       WHERE pol.polrelid=t.oid AND pol.polname=t.initial_policy
         AND pol.polcmd='*'
         AND 'authenticated'::regrole::oid=ANY(pol.polroles))
       AS original_all_authenticated_policy_present,
   EXISTS(SELECT 1 FROM pg_policy pol
       WHERE pol.polrelid=t.oid AND pol.polname=t.initial_policy
         AND pol.polcmd='*' AND pol.polpermissive
         AND pol.polroles=ARRAY['authenticated'::regrole::oid]
         AND pg_get_expr(pol.polqual,pol.polrelid) =
           '(is_platform_admin() OR jco_private.is_internal_staff(organization_id))'
         AND pg_get_expr(pol.polwithcheck,pol.polrelid) =
           '(is_platform_admin() OR jco_private.is_internal_staff(organization_id))')
       AS current_staff_guard_intact,
   (SELECT count(*) FROM approved_portal_policies a
      WHERE a.table_name=t.table_name) AS expected_portal_policy_count,
   (SELECT count(*) FROM approved_portal_policies a
      JOIN pg_policy pol ON pol.polrelid=t.oid AND pol.polname=a.policy_name
      WHERE a.table_name=t.table_name AND pol.polpermissive
        AND pol.polcmd='r' AND pol.polwithcheck IS NULL
        AND pol.polroles=ARRAY['authenticated'::regrole::oid]
        AND encode(sha256(convert_to(pg_get_expr(pol.polqual,pol.polrelid),'UTF8')),'hex')=a.using_sha256)
      AS verified_portal_policy_count,
   EXISTS(SELECT 1 FROM pg_policy extra
       WHERE extra.polrelid=t.oid AND extra.polpermissive
         AND extra.polname<>t.initial_policy
         AND NOT EXISTS (
           SELECT 1 FROM approved_portal_policies a
           WHERE a.table_name=t.table_name AND a.policy_name=extra.polname
             AND extra.polcmd='r' AND extra.polwithcheck IS NULL
             AND extra.polroles=ARRAY['authenticated'::regrole::oid]
             AND encode(sha256(convert_to(pg_get_expr(extra.polqual,extra.polrelid),'UTF8')),'hex')=a.using_sha256
         )) AS unexpected_permissive_policy_present
 FROM tables t
)
SELECT table_name,oid IS NOT NULL AS table_present,owner,rls_enabled,
 original_column_count,matching_original_columns,added_columns_since_original,
 original_index_present_valid,original_all_authenticated_policy_present,
 original_index_definition_intact,current_staff_guard_intact,
 expected_portal_policy_count,verified_portal_policy_count,
 unexpected_permissive_policy_present,
 CASE WHEN oid IS NOT NULL AND rls_enabled
     AND matching_original_columns=original_column_count
     AND original_index_present_valid AND original_all_authenticated_policy_present
     AND original_index_definition_intact AND current_staff_guard_intact
     AND expected_portal_policy_count=verified_portal_policy_count
     AND NOT unexpected_permissive_policy_present
   THEN 'BASELINE_COMPATIBLE' ELSE 'DRIFT' END AS verdict
FROM shape ORDER BY table_name;
