-- G21 / #203 - ANON direct DML minimization on authenticated-only tables.
-- Proven 2026-11-14: all 31 targets have active RLS and zero anonymous write policies.
-- SECURITY DEFINER RPC execution, authenticated and service_role grants unaffected.
-- Do not include public-consent RPCs or change any data. Never run as anon.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='40s';
DO $preflight$
DECLARE targets text[]:=ARRAY['activities','ai_usage','appointments','audit_log','commissions','compliance_packs','country_profiles','deals','documents','import_job_rows','import_jobs','invitation_roles','license_terms_versions','maintenance_requests','member_permissions','member_roles','organization_branding','organization_compliance','organization_invitations','organization_members','organization_settings','organizations','permissions','plan_features','plans','platform_admins','portal_access_links','profiles','property_owners','property_ownerships','roles']::text[];
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'G21 postgres executor required'; END IF;
 IF (SELECT count(*) FROM unnest(targets)) <> 31 OR
    (SELECT count(DISTINCT name) FROM unnest(targets) name) <> 31 THEN
   RAISE EXCEPTION 'G21 expected precisely 31 distinct tables'; END IF;
 IF EXISTS (
   SELECT 1 FROM unnest(targets) name
   LEFT JOIN pg_class c ON c.oid=to_regclass(format('public.%I',name))
   WHERE c.oid IS NULL OR c.relkind<>'r' OR NOT c.relrowsecurity
     OR NOT has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE')
 ) THEN RAISE EXCEPTION 'G21 original grants or RLS changed; abort'; END IF;
 IF EXISTS (
   SELECT 1 FROM unnest(targets) name
   JOIN pg_class c ON c.oid=to_regclass(format('public.%I',name))
   JOIN pg_policy p ON p.polrelid=c.oid
   WHERE p.polcmd IN ('*','a','w','d')
     AND (0=ANY(p.polroles) OR (SELECT oid FROM pg_roles WHERE rolname='anon')=ANY(p.polroles))
 ) THEN RAISE EXCEPTION 'G21 found a legitimate anonymous write policy; do NOT revoke'; END IF;
END
$preflight$;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.activities FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ai_usage FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.appointments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.commissions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.compliance_packs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.country_profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.deals FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.documents FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.import_job_rows FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.import_jobs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.invitation_roles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.license_terms_versions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.maintenance_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.member_permissions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.member_roles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.organization_branding FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.organization_compliance FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.organization_invitations FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.organization_members FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.organization_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.organizations FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.permissions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.plan_features FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.plans FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.platform_admins FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.portal_access_links FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.property_owners FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.property_ownerships FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.roles FROM anon;

DO $postflight$
DECLARE targets text[]:=ARRAY['activities','ai_usage','appointments','audit_log','commissions','compliance_packs','country_profiles','deals','documents','import_job_rows','import_jobs','invitation_roles','license_terms_versions','maintenance_requests','member_permissions','member_roles','organization_branding','organization_compliance','organization_invitations','organization_members','organization_settings','organizations','permissions','plan_features','plans','platform_admins','portal_access_links','profiles','property_owners','property_ownerships','roles']::text[];
BEGIN
 IF EXISTS (
   SELECT 1 FROM unnest(targets) name
   WHERE has_table_privilege('anon',format('public.%I',name),'INSERT,UPDATE,DELETE')
 ) THEN RAISE EXCEPTION 'G21 anonymous write grants remain'; END IF;
 IF NOT has_function_privilege('anon','public.tenant_public_catalog(text)','EXECUTE') THEN
   RAISE EXCEPTION 'G21 public tenant catalog must remain accessible'; END IF;
 IF NOT has_table_privilege('authenticated','public.organization_members','INSERT') OR
   NOT has_table_privilege('service_role','public.organization_members','INSERT')
 THEN RAISE EXCEPTION 'G21 authenticated and server grants changed unexpectedly'; END IF;
END
$postflight$;
COMMIT;
