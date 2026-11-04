-- INMOJCO #203 - READ ONLY: preserve closed tables flagged "RLS no policy".
-- Zero policies is intentional; never grant browser roles access to these
-- billing/security tables merely to remove the Supabase informational lint.
-- Catalogue only, no tenant rows, no DDL/DML or Auth contents.
WITH expected(schema_name, table_name, service_read) AS (
 VALUES
 ('jco_private','active_lease_correction_permits',false),
 ('private','property_intake_sites',false),
 ('private','website_contact_consents',false),
 ('public','payment_events',true)
), observed AS (
 SELECT e.*, c.oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
   pg_get_userbyid(c.relowner) AS owner_name,
   (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
   has_table_privilege('anon',c.oid,
     'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
     AS anon_any_access,
   has_table_privilege('authenticated',c.oid,
     'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
     AS authenticated_any_access,
   has_table_privilege('service_role',c.oid,'SELECT') AS service_can_read
 FROM expected e LEFT JOIN pg_class c
   ON c.oid=to_regclass(format('%I.%I',e.schema_name,e.table_name))
)
SELECT schema_name||'.'||table_name AS identifier,
  (oid IS NOT NULL) AS present,
  relrowsecurity AS rls_enabled,
  policies AS rls_policy_count,
  anon_any_access, authenticated_any_access, service_can_read,
  CASE WHEN oid IS NOT NULL AND relkind='r' AND relrowsecurity
     AND owner_name='postgres' AND policies=0
     AND anon_any_access IS FALSE AND authenticated_any_access IS FALSE
     AND service_can_read IS NOT DISTINCT FROM service_read
   THEN 'DENY_BOUNDARY_OK' ELSE 'DRIFT' END AS verdict
FROM observed ORDER BY identifier;
