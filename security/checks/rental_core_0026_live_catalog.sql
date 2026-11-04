-- INMOJCO #104 — READ-ONLY preflight of historically applied
-- 20261005153559 / 0026_rental_management_core.
-- This query inspects catalog metadata ONLY: no customer rows, DML or DDL.
-- RLS and matching object names do NOT establish SQL-body equivalence.
-- A true anon GRANT is an exposure indicator, not proof of an RLS bypass.
WITH core(relname, initial_index, initial_policy) AS (
  VALUES
    ('leases','idx_leases_org','leases_org_access'),
    ('rent_payments','idx_rent_payments_lease','rent_payments_org_access'),
    ('owner_statements','idx_owner_statements_owner','owner_statements_org_access'),
    ('maintenance_requests','idx_maintenance_property','maintenance_org_access')
)
SELECT core.relname AS table_name,
       c.oid IS NOT NULL AS exists_now,
       COALESCE(c.relrowsecurity,false) AS rls_enabled,
       to_regclass('public.' || core.initial_index) IS NOT NULL AS initial_index_exists,
       EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname=core.initial_policy) AS initial_policy_exists,
       EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname=core.initial_policy
                AND 'authenticated'::regrole::oid=ANY(p.polroles)) AS initial_policy_targets_authenticated,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('anon',c.oid,'SELECT') END AS anon_select_grant,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('anon',c.oid,'INSERT') END AS anon_insert_grant,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('anon',c.oid,'UPDATE') END AS anon_update_grant,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('anon',c.oid,'DELETE') END AS anon_delete_grant,
       CASE WHEN c.oid IS NULL THEN NULL ELSE has_table_privilege('anon',c.oid,'MAINTAIN') END AS anon_maintain_grant,
       (SELECT count(*) FROM public.permissions WHERE key = ANY(ARRAY[
         'leases.view','leases.create','leases.edit','rent_payments.view','rent_payments.create',
         'owner_statements.view','owner_statements.create','maintenance.view','maintenance.create','maintenance.edit'
       ])) AS original_permission_keys_present
FROM core LEFT JOIN pg_class c
  ON c.relname=core.relname AND c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')
ORDER BY core.relname;
