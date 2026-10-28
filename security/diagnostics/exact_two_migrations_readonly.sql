-- INMOJCO: exact, READ-ONLY preflight for two previously applied migrations.
-- Source: migration file 20261021114500, function-body md5 =
-- a43ed490a069300123b9ed6ca23b76c4, confirmed against production
-- in a read-only snapshot on 2026-10-28.
--
-- This is evidence of schema effects, NOT permission to run migration repair.
-- Changing a migration file requires updating the proof and running full CI.
-- Data, subscription rows, and Storage objects are never returned.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH versions AS (
  SELECT version FROM supabase_migrations.schema_migrations
  WHERE version IN ('20261021114500','20261021152000')
), expected_indexes(name, relation, keys) AS (
  VALUES
  ('deals_org_contact_fk_fast_idx','deals',ARRAY['organization_id','contact_id']::text[]),
  ('deals_org_property_fk_fast_idx','deals',ARRAY['organization_id','property_id']::text[]),
  ('maintenance_requests_org_fk_fast_idx','maintenance_requests',ARRAY['organization_id']::text[]),
  ('portal_links_contact_fk_fast_idx','portal_access_links',ARRAY['contact_id']::text[]),
  ('portal_links_owner_fk_fast_idx','portal_access_links',ARRAY['owner_id']::text[])
), compared_indexes AS (
  SELECT e.name,
         (ix.oid IS NOT NULL
         AND i.indisvalid AND i.indisready AND NOT i.indisunique
         AND NOT i.indisprimary AND NOT i.indisexclusion
         AND i.indexprs IS NULL AND i.indpred IS NULL
         AND i.indnatts=i.indnkeyatts AND am.amname='btree'
         AND t.relname=e.relation AND t.relnamespace='public'::regnamespace
         AND e.keys IS NOT DISTINCT FROM (
           SELECT array_agg(a.attname::text ORDER BY k.ordinality)
           FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
           JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)
         ) AS matches
  FROM expected_indexes e
  LEFT JOIN pg_class ix ON ix.relname=e.name AND ix.relnamespace='public'::regnamespace
  LEFT JOIN pg_index i ON i.indexrelid=ix.oid
  LEFT JOIN pg_class t ON t.oid=i.indrelid
  LEFT JOIN pg_am am ON am.oid=ix.relam
), observed AS (
  SELECT
    EXISTS(SELECT 1 FROM versions WHERE version='20261021114500') AS billing_history,
    EXISTS(SELECT 1 FROM versions WHERE version='20261021152000') AS index_history,
    (SELECT md5(p.prosrc) FROM pg_proc p
      WHERE p.oid=to_regprocedure('public.billing_create_order(uuid,uuid,text,uuid)'))
      AS checkout_md5,
    (SELECT
       pg_get_function_result(p.oid)='jsonb'
       AND l.lanname='plpgsql'
       AND p.prosecdef
       AND p.provolatile='v'
       AND p.proparallel='u'
       AND p.proconfig=ARRAY['search_path=""']::text[]
       AND pg_get_function_identity_arguments(p.oid)=
         'target_org uuid, target_plan uuid, target_environment text, request_key uuid'
     FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
     WHERE p.oid=to_regprocedure('public.billing_create_order(uuid,uuid,text,uuid)'))
       AS checkout_contract_matches,
    (SELECT count(*) FROM compared_indexes WHERE matches IS TRUE) AS valid_indexes
)
SELECT jsonb_pretty(jsonb_build_object(
  'billing_version','20261021114500',
  'billing_function_exact_body_matches_source',
     checkout_md5='a43ed490a069300123b9ed6ca23b76c4',
  'billing_function_signature_and_security_match',coalesce(checkout_contract_matches,false),
  'billing_history_recorded',billing_history,
  'tenant_indexes_version','20261021152000',
  'tenant_indexes_exact_match',valid_indexes=5,
  'tenant_indexes_matching_count',valid_indexes,
  'tenant_indexes_history_recorded',index_history,
  'next_step',
    CASE
      WHEN checkout_md5 IS DISTINCT FROM 'a43ed490a069300123b9ed6ca23b76c4'
        OR checkout_contract_matches IS DISTINCT FROM true
        OR valid_indexes<>5 THEN 'STOP_SCHEMA_DRIFT_INVESTIGATE'
      WHEN NOT billing_history OR NOT index_history THEN 'SCHEMA_EFFECTS_MATCH_HISTORY_REPAIR_ONLY_AFTER_VERIFIED_RESTORE'
      ELSE 'MIGRATION_HISTORY_AND_EFFECTS_MATCH'
    END,
  'safety','READ_ONLY_NO_CHANGES_TO_LIVE_DB'
)) AS migration_preflight
FROM observed;
ROLLBACK;
