-- INMOJCO: migration reconciliation DIAGNOSTIC ONLY.
-- Non-destructive inventory for active Supabase cuitgyqrjibgwuniapmk.
-- Never marks migration versions as applied and never modifies PostgreSQL.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH expected_indexes(index_name, expected_definition) AS (
  VALUES
    ('deals_org_contact_fk_fast_idx','CREATE INDEX deals_org_contact_fk_fast_idx ON public.deals USING btree (organization_id, contact_id)'),
    ('deals_org_property_fk_fast_idx','CREATE INDEX deals_org_property_fk_fast_idx ON public.deals USING btree (organization_id, property_id)'),
    ('maintenance_requests_org_fk_fast_idx','CREATE INDEX maintenance_requests_org_fk_fast_idx ON public.maintenance_requests USING btree (organization_id)'),
    ('portal_links_contact_fk_fast_idx','CREATE INDEX portal_links_contact_fk_fast_idx ON public.portal_access_links USING btree (contact_id)'),
    ('portal_links_owner_fk_fast_idx','CREATE INDEX portal_links_owner_fk_fast_idx ON public.portal_access_links USING btree (owner_id)')
),
index_review AS (
  SELECT count(*) FILTER (WHERE idx.indexdef = exp.expected_definition
      AND x.indisvalid AND x.indisready AND x.indislive) = 5 AS exact_indexes_match
  FROM expected_indexes exp
  LEFT JOIN pg_indexes idx ON idx.schemaname='public' AND idx.indexname=exp.index_name
  LEFT JOIN pg_namespace n ON n.nspname='public'
  LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=exp.index_name
  LEFT JOIN pg_index x ON x.indexrelid=c.oid
),
function_review AS (
  SELECT coalesce((
    SELECT md5(regexp_replace(p.prosrc,'[[:space:]]','','g'))
      = 'd185d811453e6f50b4ae3ee54f6da390'
    FROM pg_proc p
    WHERE p.oid=to_regprocedure('public.billing_create_order(uuid,uuid,text,uuid)')
  ),false) AS checkout_body_matches_reviewed_git_source
),
facts AS (
  SELECT '20261021114500' AS version, checkout_body_matches_reviewed_git_source AS effects_match
  FROM function_review
  UNION ALL
  SELECT '20261021152000', exact_indexes_match
  FROM index_review
)
SELECT facts.version,
       EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version=facts.version) AS history_recorded,
       facts.effects_match AS effects_match_git_main,
       CASE
         WHEN NOT facts.effects_match THEN 'REVIEW_EFFECT_DRIFT_BEFORE_ANY_CHANGE'
         WHEN NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version=facts.version)
           THEN 'RECONCILE_MIGRATION_HISTORY_WITHOUT_REAPPLYING_DDL'
         ELSE 'HISTORY_AND_EFFECTS_MATCH'
       END AS diagnostic
FROM facts
ORDER BY version;

COMMIT;
