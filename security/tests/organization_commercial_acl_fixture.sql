-- Disposable PostgreSQL 17 fixture only. Does not contain actual tenants.
DO $roles$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$roles$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS
 'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.organizations(
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  legal_name text,
  tax_id text,
  email text,
  phone text,
  whatsapp text,
  logo_url text,
  status text NOT NULL,
  plan_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
INSERT INTO public.organizations(id,name,slug,status,plan_id) VALUES
 ('11111111-1111-4111-8111-111111111111','Tenant Alpha','tenant-alpha','ACTIVE',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('22222222-2222-4222-8222-222222222222','Tenant Beta','tenant-beta','ACTIVE',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- Simulate the existing RLS authorization: only Alpha's authenticated
-- operator with settings.edit may edit Alpha's branding.
CREATE FUNCTION public.has_org_permission(target_org uuid,permission_key text)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS
'SELECT target_org=''11111111-1111-4111-8111-111111111111''::uuid
    AND permission_key=''settings.edit''
    AND auth.uid()=''33333333-3333-4333-8333-333333333333''::uuid';
GRANT EXECUTE ON FUNCTION public.has_org_permission(uuid,text) TO authenticated;
CREATE POLICY organizations_select_member ON public.organizations FOR SELECT
TO authenticated USING (public.has_org_permission(id,'settings.edit'));
CREATE POLICY organizations_update_settings_admin ON public.organizations
FOR UPDATE TO authenticated
USING (public.has_org_permission(id,'settings.edit'))
WITH CHECK (public.has_org_permission(id,'settings.edit'));

-- Recreate the insecure pre-migration table-wide privileges found in Supabase.
GRANT SELECT,UPDATE ON public.organizations TO anon,authenticated;
GRANT SELECT,UPDATE ON public.organizations TO service_role;

-- Representative owner-validated SECURITY DEFINER RPC used by SettingsModule.
-- The real Supabase function additionally validates slug format, reserved
-- words, org ACTIVE state and records an audit event.
CREATE FUNCTION public.set_organization_public_slug(target_org uuid,desired_slug text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $rpc$
BEGIN
 IF auth.uid() IS DISTINCT FROM '33333333-3333-4333-8333-333333333333'::uuid
    OR target_org IS DISTINCT FROM '11111111-1111-4111-8111-111111111111'::uuid
 THEN RAISE EXCEPTION 'Only organization owner may change public slug'
   USING ERRCODE='42501';
 END IF;
 UPDATE public.organizations
 SET slug=desired_slug,updated_at=now() WHERE id=target_org;
 RETURN desired_slug;
END
$rpc$;
REVOKE EXECUTE ON FUNCTION public.set_organization_public_slug(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_organization_public_slug(uuid,text) TO authenticated;
