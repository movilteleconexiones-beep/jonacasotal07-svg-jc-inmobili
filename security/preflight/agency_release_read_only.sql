-- INMOJCO: production schema preflight. READ ONLY.
-- No DDL, no writes, no access-token or secret disclosure.
-- Run in the correct Supabase project after taking a DB backup.
BEGIN READ ONLY;

SELECT current_database() AS database_name,
       current_user AS executing_role,
       current_setting('server_version') AS postgres_version;

-- Object presence only: NULL indicates a missing prerequisite or un-applied migration.
SELECT
 to_regclass('public.properties') AS private_inventory,
 to_regclass('public.organizations') AS tenant_organizations,
 to_regclass('public.organization_members') AS agency_memberships,
 to_regclass('public.member_roles') AS agency_role_bindings,
 to_regclass('public.portal_access_links') AS external_portal_links,
 to_regclass('private.property_intake_sites') AS public_catalog_sites,
 to_regclass('public.property_publications') AS published_listing_metadata,
 to_regclass('public.agency_custom_domains') AS pending_agency_domains,
 to_regclass('storage.buckets') AS storage_bucket_registry;

-- Expected new functions are NULL until their individual migration is applied.
SELECT
 to_regprocedure('jco_private.is_internal_staff(uuid)') AS internal_staff_guard,
 to_regprocedure('public.get_public_agency_listings(text,integer,integer)') AS public_listing_rpc,
 to_regprocedure('public.configure_my_agency_public_site(uuid,boolean)') AS storefront_configuration_rpc,
 to_regprocedure('public.request_agency_custom_domain(uuid,text)') AS pending_domain_request_rpc,
 to_regprocedure('public.get_my_agency_custom_domain(uuid)') AS domain_status_rpc,
 to_regprocedure('jco_private.can_read_authorized_external_property(uuid,uuid)') AS private_personal_access_guard;

-- Review any permissive SELECT policies before enabling the defensive restrictive guard.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname IN ('public','storage')
  AND tablename IN ('properties','property_publications','agency_custom_domains','objects')
ORDER BY schemaname,tablename,cmd,policyname;

-- Never treat granting SELECT on private inventory to 'anon' as acceptable.
SELECT
 has_table_privilege('anon','public.properties','SELECT') AS anon_can_select_private_properties,
 has_table_privilege('authenticated','public.properties','SELECT') AS auth_can_query_rls_filtered_properties;

-- Verify every anonymous table privilege that a broad legacy grant could
-- accidentally expose. Direct public operations use audited SECURITY DEFINER
-- functions; the private inventory must not expose table-level DML.
SELECT
 has_table_privilege('anon','public.properties','SELECT') AS anonymous_can_select,
 has_table_privilege('anon','public.properties','INSERT') AS anonymous_can_insert,
 has_table_privilege('anon','public.properties','UPDATE') AS anonymous_can_update,
 has_table_privilege('anon','public.properties','DELETE') AS anonymous_can_delete,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.properties'::regclass) AS private_rls_enabled,
 (SELECT count(*) FROM pg_policies WHERE schemaname='public'
  AND tablename='properties' AND policyname='jco_platform_admin_properties_read'
  AND cmd='SELECT' AND permissive='PERMISSIVE') AS platform_admin_global_read_policies,
 (SELECT count(*) FROM pg_policies WHERE schemaname='public'
  AND tablename='properties' AND policyname='jco_private_properties_tenant_read_boundary'
  AND cmd='SELECT' AND permissive='RESTRICTIVE') AS tenant_read_boundary_policies;

-- Cardinalities only: no emails, personal identifiers, payment details,
-- residential addresses or secret configuration are returned.
SELECT
 (SELECT count(*) FROM public.platform_admins WHERE active) AS active_platform_admins,
 (SELECT count(*) FROM public.organizations WHERE status='ACTIVE') AS active_agencies,
 (SELECT count(*) FROM public.properties) AS properties_total,
 (SELECT count(*) FROM private.property_intake_sites WHERE enabled) AS public_sites_enabled;

-- Do not grant SERVICE_ROLE or bypass-RLS credentials to users in the browser.
ROLLBACK;
