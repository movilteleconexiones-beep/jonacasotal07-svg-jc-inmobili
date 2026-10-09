-- JCO SECURITY REVIEW: migration candidate, NOT deployed.
-- Prerequisite: review application writes to member_roles/member_permissions/role_permissions.
-- Replaces permissive role/permission delegation paths with constrained RLS.
-- Review under a dedicated staging DB before production.

BEGIN;

-- Platform administrators: retain the existing self-read policy.
DROP POLICY IF EXISTS "Permitir lectura a usuarios autenticados" ON public.platform_admins;

-- Privilege delegation is NOT safe if any role editor can grant arbitrary keys.
-- Revoke direct client writes; only reviewed server-side functions should manage grants.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.role_permissions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.member_permissions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.member_roles FROM anon, authenticated;

-- Remove permissive write policies to reduce future accidental privilege exposure.
DROP POLICY IF EXISTS role_permissions_manage_admin ON public.role_permissions;
DROP POLICY IF EXISTS member_permissions_manage_admin ON public.member_permissions;
DROP POLICY IF EXISTS member_roles_manage_admin ON public.member_roles;

-- Restrict the existing custom-role creation function to the caller's own
-- permissions and an explicit catalog of tenant-operational permissions.
CREATE OR REPLACE FUNCTION public.create_custom_role(
  target_org uuid, role_name text, role_description text, permission_keys text[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_role_id uuid;
  requested_count integer;
  approved_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_permission(target_org, 'roles.create') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF role_name IS NULL OR length(btrim(role_name)) < 2 OR length(btrim(role_name)) > 100 THEN
    RAISE EXCEPTION 'Invalid role name';
  END IF;
  IF permission_keys IS NULL OR array_position(permission_keys, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid permissions';
  END IF;

  SELECT count(DISTINCT k) INTO requested_count FROM unnest(permission_keys) AS x(k);
  SELECT count(DISTINCT p.key) INTO approved_count
  FROM public.permissions p
  WHERE p.key = ANY(permission_keys)
    AND p.key = ANY(ARRAY[
      'appointments.create','appointments.edit','appointments.view',
      'clients.create','clients.edit','clients.view',
      'commissions.create','commissions.edit','commissions.view',
      'deals.close','deals.create','deals.edit','deals.view',
      'documents.delete','documents.upload','documents.view',
      'leads.assign','leads.edit','leads.view',
      'owners.create','owners.edit','owners.view',
      'properties.create','properties.delete','properties.edit','properties.view',
      'reports.view','settings.view','users.view'
    ]::text[])
    AND public.has_org_permission(target_org, p.key);

  IF requested_count <> approved_count THEN
    RAISE EXCEPTION 'Permission cannot be delegated';
  END IF;

  INSERT INTO public.roles(organization_id,name,description,is_system_role,active)
  VALUES(target_org,btrim(role_name),nullif(btrim(role_description),''),false,true)
  RETURNING id INTO new_role_id;

  INSERT INTO public.role_permissions(role_id,permission_id)
  SELECT new_role_id,p.id FROM public.permissions p
  WHERE p.key = ANY(permission_keys)
  ON CONFLICT DO NOTHING;
  RETURN new_role_id;
END;
$$;

COMMIT;

-- STOP: review any existing SECURITY DEFINER grant/edit functions and their EXECUTE grants.
-- Client role assignment is intentionally disabled pending a vetted server RPC.
-- Do not deploy this migration without updating legitimate role-assignment flows.
