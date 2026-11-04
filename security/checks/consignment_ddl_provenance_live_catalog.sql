-- #104/#203: READ-ONLY scan of 99 authentic applied SQL bodies in Supabase.
-- Searches direct CREATE TABLE/FUNCTION spellings, NOT dynamic EXECUTE,
-- manual SQL-editor operations, unrecorded DDL or the true order of edits.
-- Never assume a missing direct match means the object never existed.
-- No SQL bodies, tenant records, IDs or credentials in the output.
WITH expected(kind, object_ref, signature, sql_pattern) AS (
  VALUES
    ('table','private.property_intake_sites','',
     '\mCREATE[[:space:]]+TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?(private\.)?property_intake_sites\M'),
    ('table','public.property_consignments','',
     '\mCREATE[[:space:]]+TABLE[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?(public\.)?property_consignments\M'),
    ('function','private.can_read_portal_property',
     'private.can_read_portal_property(uuid,uuid)',
     '\mCREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+(private\.)?can_read_portal_property\M'),
    ('function','public.get_public_property_intake_site',
     'public.get_public_property_intake_site(text)',
     '\mCREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+(public\.)?get_public_property_intake_site\M'),
    ('function','public.submit_property_consignment',
     'public.submit_property_consignment(text,uuid,jsonb)',
     '\mCREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+(public\.)?submit_property_consignment\M')
), ledger AS (
  SELECT version,name,array_to_string(statements,E'\n') AS sql_body
  FROM supabase_migrations.schema_migrations
)
SELECT e.kind,e.object_ref,
 CASE WHEN e.kind='table' THEN to_regclass(e.object_ref) IS NOT NULL
      ELSE to_regprocedure(e.signature) IS NOT NULL END AS currently_present,
 count(l.version) FILTER (WHERE l.sql_body ~* e.sql_pattern) AS direct_create_matches,
 coalesce(jsonb_agg(jsonb_build_object('version',l.version,'migration',l.name)
   ORDER BY l.version)
   FILTER (WHERE l.sql_body ~* e.sql_pattern),'[]'::jsonb) AS direct_create_migrations
FROM expected e CROSS JOIN ledger l
GROUP BY e.kind,e.object_ref,e.signature
ORDER BY e.kind,e.object_ref;
