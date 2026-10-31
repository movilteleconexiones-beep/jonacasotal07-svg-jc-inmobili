-- Read-only privilege review: safe for production, no data or schema writes.
DO $check$
BEGIN
 IF has_column_privilege('authenticated','public.organizations','plan_id','UPDATE')
   OR has_column_privilege('authenticated','public.organizations','status','UPDATE')
   OR has_column_privilege('authenticated','public.organizations','id','UPDATE')
   OR has_column_privilege('authenticated','public.organizations','created_at','UPDATE')
   OR has_any_column_privilege('anon','public.organizations','UPDATE') THEN
   RAISE EXCEPTION 'Untrusted API role has direct organization commercial UPDATE privilege';
 END IF;
 IF NOT has_column_privilege('authenticated','public.organizations','name','UPDATE')
    OR NOT has_column_privilege('authenticated','public.organizations','slug','UPDATE')
    OR NOT has_column_privilege('authenticated','public.organizations','logo_url','UPDATE')
    OR NOT has_column_privilege('authenticated','public.organizations','email','UPDATE')
    OR NOT has_column_privilege('authenticated','public.organizations','updated_at','UPDATE') THEN
   RAISE EXCEPTION 'Tenant branding edit rights were unexpectedly revoked';
 END IF;
 IF NOT has_column_privilege('service_role','public.organizations','plan_id','UPDATE')
    OR NOT has_column_privilege('service_role','public.organizations','status','UPDATE') THEN
   RAISE EXCEPTION 'Trusted billing services cannot change plan or tenant status';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_policies
   WHERE schemaname='public' AND tablename='organizations'
     AND policyname='organizations_update_settings_admin'
     AND cmd='UPDATE' AND 'authenticated'=ANY(roles)
 ) THEN
   RAISE EXCEPTION 'Expected tenant-scoped organization settings RLS policy missing';
 END IF;
 RAISE NOTICE 'PASS: only branding columns writable by tenant settings admin, commercial updates remain service-only';
END
$check$;
