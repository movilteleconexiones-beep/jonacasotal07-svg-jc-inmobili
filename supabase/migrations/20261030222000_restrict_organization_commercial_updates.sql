-- SQL privilege hardening for the active INMOJCO Supabase tenant table.
-- Important: RLS protects ROWS, not individual COLUMNS. An organization
-- administrator with settings.edit must never use the Data API to alter the
-- commercial subscription plan or activate/suspend an organization.
-- Keep existing organization_update_settings_admin RLS unchanged.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'Expected organizations table missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
           WHERE oid='public.organizations'::regclass) THEN
    RAISE EXCEPTION 'organizations RLS must remain active';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
     WHERE schemaname='public' AND tablename='organizations'
       AND policyname='organizations_update_settings_admin'
  ) THEN
    RAISE EXCEPTION 'Expected tenant admin settings policy changed; review required';
  END IF;
END
$preflight$;

-- Table-level UPDATE allows modifying EVERY column, even when RLS restricts
-- the row. It must be removed BEFORE narrower column-level privileges apply.
REVOKE UPDATE ON TABLE public.organizations FROM anon,authenticated;
REVOKE UPDATE(id,plan_id,status,created_at) ON TABLE public.organizations
  FROM anon,authenticated;

-- A tenant with settings.edit can still customize its own identity and
-- contact details. Its RLS policy continues to scope changes to its tenant.
GRANT UPDATE(name,slug,legal_name,tax_id,email,phone,whatsapp,logo_url,updated_at)
  ON TABLE public.organizations TO authenticated;

DO $postcondition$
BEGIN
  IF has_column_privilege('authenticated','public.organizations','plan_id','UPDATE')
    OR has_column_privilege('authenticated','public.organizations','status','UPDATE')
    OR has_column_privilege('authenticated','public.organizations','id','UPDATE')
    OR has_column_privilege('authenticated','public.organizations','created_at','UPDATE')
    OR has_any_column_privilege('anon','public.organizations','UPDATE') THEN
    RAISE EXCEPTION 'Commercial or anonymous organization column still writable';
  END IF;
  IF NOT has_column_privilege('authenticated','public.organizations','name','UPDATE')
    OR NOT has_column_privilege('authenticated','public.organizations','logo_url','UPDATE')
    OR NOT has_column_privilege('authenticated','public.organizations','updated_at','UPDATE') THEN
    RAISE EXCEPTION 'Tenant branding edit capability was lost';
  END IF;
  IF NOT has_column_privilege('service_role','public.organizations','plan_id','UPDATE')
    OR NOT has_column_privilege('service_role','public.organizations','status','UPDATE') THEN
    RAISE EXCEPTION 'Trusted billing service lost commercial update access';
  END IF;
END
$postcondition$;

COMMIT;
