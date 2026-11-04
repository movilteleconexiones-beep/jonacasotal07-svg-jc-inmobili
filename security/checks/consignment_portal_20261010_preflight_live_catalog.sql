-- INMOJCO #104: catalogue-only verification for TWO actual Supabase
-- migration bodies recorded at 20261010232928 and 20261010232930.
-- These were DO preflights, NOT the DDL files with the same logical names.
-- READ ONLY: never run either local DDL in production to reconcile a version.
-- The checks mirror the historic preflights and do not prove function-body
-- equivalence, protection against recursion, or end-to-end tenant isolation.
-- Do not treat every OK as authorization for migration repair or db push.
WITH checks(check_id, passed) AS (
  VALUES
  ('consignment.private_site_table', to_regclass('private.property_intake_sites') IS NOT NULL),
  ('consignment.public_queue_table', to_regclass('public.property_consignments') IS NOT NULL),
  ('consignment.public_site_rpc', to_regprocedure('public.get_public_property_intake_site(text)') IS NOT NULL),
  ('consignment.public_submit_rpc', to_regprocedure('public.submit_property_consignment(text,uuid,jsonb)') IS NOT NULL),
  ('consignment.review_rpc', to_regprocedure('public.review_property_consignment(uuid,text,text)') IS NOT NULL),
  ('consignment.queue_rls', (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.property_consignments')) IS TRUE),
  ('consignment.private_site_rls', (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('private.property_intake_sites')) IS TRUE),
  ('consignment.anon_no_site_read', COALESCE(NOT has_table_privilege('anon',to_regclass('private.property_intake_sites'),'SELECT'),FALSE)),
  ('consignment.auth_no_queue_insert', COALESCE(NOT has_table_privilege('authenticated',to_regclass('public.property_consignments'),'INSERT'),FALSE)),
  ('consignment.anon_submit_execute', COALESCE(has_function_privilege('anon',to_regprocedure('public.submit_property_consignment(text,uuid,jsonb)'),'EXECUTE'),FALSE)),
  ('consignment.queue_read_policy', EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=to_regclass('public.property_consignments') AND p.polname='property_consignments_read')),
  ('consignment.six_indexes', (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='property_consignments' AND indexname IN
    ('property_consignments_org_created','property_consignments_org_phone_created','property_consignments_reviewed_by','property_consignments_property','property_consignments_contact','property_consignments_lead')) = 6),
  ('recursion.helper_exists', to_regprocedure('private.can_read_portal_property(uuid,uuid)') IS NOT NULL),
  ('recursion.properties_select_uses_helper', EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=to_regclass('public.properties')
    AND p.polname='properties_select_portal_related' AND pg_get_expr(p.polqual,p.polrelid) LIKE '%private.can_read_portal_property%')),
  ('recursion.ownerships_select_policy', EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=to_regclass('public.property_ownerships')
    AND p.polname='ownerships_select_portal_owner')),
  ('recursion.anon_no_helper_execute', COALESCE(NOT has_function_privilege('anon',to_regprocedure('private.can_read_portal_property(uuid,uuid)'),'EXECUTE'),FALSE))
)
SELECT check_id, CASE WHEN passed THEN 'OK' ELSE 'DRIFT' END AS finding
FROM checks ORDER BY check_id;
