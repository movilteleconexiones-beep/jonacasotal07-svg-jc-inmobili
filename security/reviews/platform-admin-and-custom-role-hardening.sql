-- REVIEW FIRST. This migration is NOT applied automatically.
-- JCO: restrict visibility of platform administrators and tenant-defined permissions.
-- Run in a transaction with a rollback plan after verifying current grants and policies.

BEGIN;

-- Existing broad policy allows every authenticated user to read all platform admins.
DROP POLICY IF EXISTS "Permitir lectura a usuarios autenticados" ON public.platform_admins;

-- Preserve the existing self-read/platform-admin policy:
-- platform_admins_self_read: user_id = auth.uid() OR is_platform_admin()

CREATE OR REPLACE FUNCTION public.create_custom_role(
  target_org uuid,
  role_name text,
  role_description text,
  permission_keys text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  new_role_id uuid;
  requested_count integer;
  allowed_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_permission(target_org, 'roles.create') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF role_name IS NULL OR length(btrim(role_name)) < 2 THEN
    RAISE EXCEPTION 'Role name is required';
  END IF;

  IF permission_keys IS NULL OR array_position(permission_keys, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid permission keys';
  END IF;

  SELECT count(DISTINCT key) INTO requested_count
  FROM unnest(permission_keys) AS requested(key);

  -- A tenant role can only delegate permissions the caller already possesses
  -- in this tenant. Platform-wide permission keys must never be delegated.
  SELECT count(DISTINCT p.key) INTO allowed_count
  FROM public.permissions p
  WHERE p.key = ANY(permission_keys)
    AND p.key !~* '(^|[._-])(platform|super_admin|superadmin|system|billing_admin)([._-]|$)'
    AND public.has_org_permission(target_org, p.key);

  IF requested_count <> allowed_count THEN
    RAISE EXCEPTION 'One or more permissions cannot be delegated';
  END IF;

  INSERT INTO public.roles (organization_id, name, description, is_system_role, active)
  VALUES (target_org, btrim(role_name), nullif(btrim(role_description), ''), false, true)
  RETURNING id INTO new_role_id;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT new_role_id, p.id
  FROM public.permissions p
  WHERE p.key = ANY(permission_keys)
  ON CONFLICT DO NOTHING;

  RETURN new_role_id;
END;
$function$;

COMMIT;

-- NOTE: also review role_permissions_manage_admin: its existing ALL policy
-- allows a roles.edit user to attach privileged permissions directly.
-- Do not declare tenant permission delegation secure until direct INSERT/UPDATE
-- grants/policies are hardened and tested.
