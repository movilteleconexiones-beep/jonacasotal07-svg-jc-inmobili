-- INMOJCO: ACL and RLS review for sensitive public/private data.
-- Strictly read-only; returns no customer records, emails, property IDs or tokens.
-- Intentionally public SECURITY DEFINER RPCs are assessed separately.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH protected(schema_name, table_name) AS (
 VALUES
 ('public','contacts'),
 ('public','leads'),
 ('public','payment_orders'),
 ('public','payment_events'),
 ('public','property_consignments'),
 ('private','property_intake_sites'),
 ('private','website_contact_consents')
), relation_status AS (
 SELECT p.schema_name,p.table_name,c.oid,c.relrowsecurity,
   CASE WHEN c.oid IS NOT NULL THEN
     has_table_privilege('anon',c.oid,'SELECT') OR
     has_table_privilege('anon',c.oid,'INSERT') OR
     has_table_privilege('anon',c.oid,'UPDATE') OR
     has_table_privilege('anon',c.oid,'DELETE')
   ELSE true END AS anon_direct_access
 FROM protected p
 LEFT JOIN pg_namespace n ON n.nspname=p.schema_name
 LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=p.table_name
)
SELECT count(*) AS sensitive_tables_checked,
 count(*) FILTER (WHERE oid IS NULL) AS required_tables_missing,
 count(*) FILTER (WHERE NOT coalesce(relrowsecurity,false)) AS tables_without_rls,
 count(*) FILTER (WHERE anon_direct_access) AS tables_with_unexpected_anon_grants
FROM relation_status;

COMMIT;
