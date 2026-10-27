-- INMOJCO: inventario de recuperación SOLO LECTURA.
-- Ejecutar en el proyecto Supabase cuitgyqrjibgwuniapmk.
-- No exporta filas de clientes, identificadores de objetos ni secretos.
-- NO ES UN RESPALDO y no valida restaurabilidad.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT current_database() AS database_name,
       current_setting('server_version') AS postgres_version,
       pg_size_pretty(pg_database_size(current_database())) AS database_size,
       now() AT TIME ZONE 'UTC' AS sampled_at_utc;

SELECT count(*) AS public_tables,
       count(*) FILTER (WHERE c.relrowsecurity) AS public_tables_with_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

SELECT b.id AS bucket,
       b.public AS publicly_accessible,
       (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = b.id) AS object_count
FROM storage.buckets b
ORDER BY b.id;

SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       count(p.polname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE (n.nspname = 'public' AND c.relname = 'payment_events')
   OR (n.nspname = 'private' AND c.relname IN
       ('property_intake_sites', 'website_contact_consents'))
GROUP BY n.nspname, c.relname, c.relrowsecurity
ORDER BY n.nspname, c.relname;

SELECT
  EXISTS(
    SELECT 1
    FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.billing_create_order(uuid,uuid,text,uuid)')
      AND position('Plan change requires administrative review'
                   IN pg_get_functiondef(p.oid)) > 0
  ) AS checkout_contract_guard_present,
  (SELECT count(*) FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN (
       'deals_org_contact_fk_fast_idx',
       'deals_org_property_fk_fast_idx',
       'maintenance_requests_org_fk_fast_idx',
       'portal_links_contact_fk_fast_idx',
       'portal_links_owner_fk_fast_idx'
     )) AS tenant_index_count;

SELECT version
FROM supabase_migrations.schema_migrations
WHERE version IN ('20261021114500','20261021152000')
ORDER BY version;

COMMIT;
