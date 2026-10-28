-- INMOJCO — release readiness snapshot, READ ONLY.
-- Execute ONLY against cuitgyqrjibgwuniapmk as an authorized DB auditor.
-- Aggregated information only: NO tenant names, client records, secrets,
-- payment details, file keys or object contents are returned.
--
-- CRITICAL: SQL cannot establish the existence of a separately archived
-- and successfully restored PostgreSQL/Storage backup; GitHub branch
-- immutability; Railway deployment readiness; or a real Wompi payment.
-- Treat any such missing external evidence as NO-GO, without exceptions.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH public_tables AS (
  SELECT c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN('r','p')
), sensitive_tables AS (
  SELECT n.nspname,c.relname,c.oid,c.relrowsecurity,
         has_table_privilege('anon',c.oid,'SELECT')
         OR has_table_privilege('anon',c.oid,'INSERT')
         OR has_table_privilege('anon',c.oid,'UPDATE')
         OR has_table_privilege('anon',c.oid,'DELETE') AS anon_direct_grant
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname='public' AND c.relname IN
    ('contacts','leads','payment_orders','payment_events','property_consignments'))
    OR (n.nspname='private' AND c.relname IN
    ('property_intake_sites','website_contact_consents'))
), access_summary AS (
  SELECT count(*) AS checked,
         count(*) FILTER (WHERE NOT relrowsecurity) AS without_rls,
         count(*) FILTER (WHERE anon_direct_grant) AS with_unexpected_anon_grants
  FROM sensitive_tables
), version_check AS (
  SELECT count(*) FILTER (WHERE version='20261021114500') AS billing_contract_history,
         count(*) FILTER (WHERE version='20261021152000') AS tenant_index_history
  FROM supabase_migrations.schema_migrations
), storage_summary AS (
  SELECT (SELECT count(*) FROM storage.buckets WHERE public IS FALSE) AS private_buckets,
         (SELECT count(*) FROM storage.objects) AS object_count
), billing_summary AS (
  SELECT count(*) AS rows,
         coalesce(bool_and(sandbox_enabled),false) AS sandbox_enabled,
         coalesce(bool_or(production_enabled),true) AS any_production_payments_enabled,
         coalesce(bool_and(activation_mode='VERIFIED_PAYMENT'),false) AS verified_payment_only
  FROM public.billing_activation_settings
), roles_summary AS (
  SELECT has_schema_privilege('anon','public','CREATE')
    OR has_schema_privilege('authenticated','public','CREATE')
    AS public_schema_create_allowed
)
SELECT jsonb_pretty(jsonb_build_object(
  'project_ref','cuitgyqrjibgwuniapmk',
  'observed_utc',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'postgres_version',current_setting('server_version'),
  'public_tables',jsonb_build_object(
     'total',(SELECT count(*) FROM public_tables),
     'rls_enabled',(SELECT count(*) FROM public_tables WHERE relrowsecurity)),
  'sensitive_tables',jsonb_build_object(
     'checked',a.checked,'without_rls',a.without_rls,
     'unexpected_anon_grants',a.with_unexpected_anon_grants),
  'roles',jsonb_build_object('anon_or_authenticated_can_create_in_public',r.public_schema_create_allowed),
  'billing',jsonb_build_object(
     'settings_rows',b.rows,'sandbox_enabled',b.sandbox_enabled,
     'production_payments_enabled',b.any_production_payments_enabled,
     'verified_payment_only',b.verified_payment_only),
  'storage_inventory',jsonb_build_object('private_buckets',s.private_buckets,'objects',s.object_count),
  'unreconciled_migrations',to_jsonb(array_remove(ARRAY[
     CASE WHEN v.billing_contract_history=0 THEN '20261021114500'::text ELSE NULL END,
     CASE WHEN v.tenant_index_history=0 THEN '20261021152000'::text ELSE NULL END
  ],NULL)),
  'external_evidence',jsonb_build_object(
     'postgresql_real_dump_and_isolated_restore','NOT_VERIFIED_BY_SQL',
     'storage_bytes_backup_and_restore','NOT_VERIFIED_BY_SQL',
     'github_backup_branch_immutability','NOT_VERIFIED_BY_SQL',
     'railway_candidate_build_and_rollback','NOT_VERIFIED_BY_SQL'),
  'release_decision','NO_GO_UNTIL_EXTERNAL_BACKUP_RESTORE_AND_ALL_GATES_VERIFIED'
)) AS readonly_prelaunch_snapshot
FROM access_summary a CROSS JOIN version_check v
CROSS JOIN storage_summary s CROSS JOIN billing_summary b CROSS JOIN roles_summary r;

COMMIT;
