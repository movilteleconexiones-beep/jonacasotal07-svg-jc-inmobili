-- ISOLATED PG17 FIXTURE ONLY: exact live SOURCE pinned for regression, not deployable.
CREATE OR REPLACE FUNCTION public.admin_update_role_permissions(target_org uuid, target_role uuid, desired_permission_keys text[], expected_permission_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  actor uuid := auth.uid();
  role_record public.roles%ROWTYPE;
  current_keys text[];
  desired_keys text[];
  expected_keys text[];
  added_keys text[];
  removed_keys text[];
  protected_keys constant text[] := ARRAY[
    'roles.view','roles.edit','roles.assign','users.view','users.edit'
  ];
  restricted_keys constant text[] := ARRAY[
    'roles.view','roles.edit','roles.assign','roles.create',
    'users.create','users.edit','users.disable','settings.edit',
    'properties.delete','documents.delete'
  ];
BEGIN
  IF actor IS NULL OR target_org IS NULL OR target_role IS NULL OR
    NOT public.has_org_permission(target_org,'roles.edit') OR
    NOT EXISTS (
      SELECT 1 FROM public.organization_members m
      JOIN public.member_roles mr ON mr.organization_member_id=m.id
      JOIN public.roles ar ON ar.id=mr.role_id
      WHERE m.organization_id=target_org AND m.user_id=actor AND m.status='ACTIVE'
        AND ar.active AND ar.organization_id=target_org AND ar.key='ADMIN'
    ) THEN
    RAISE EXCEPTION 'Only the organization administrator may modify profile permissions'
      USING ERRCODE='42501';
  END IF;

  SELECT * INTO role_record FROM public.roles r
    WHERE r.id=target_role AND r.organization_id=target_org AND r.active
    FOR UPDATE;
  IF NOT FOUND OR role_record.key IN ('ORGANIZATION_OWNER','SUPER_ADMIN','PLATFORM_OWNER') THEN
    RAISE EXCEPTION 'Role is not editable within this organization'
      USING ERRCODE='42501';
  END IF;

  IF desired_permission_keys IS NULL OR expected_permission_keys IS NULL OR
     array_position(desired_permission_keys,NULL) IS NOT NULL OR
     array_position(expected_permission_keys,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'A complete non-null permission selection is required'
      USING ERRCODE='22023';
  END IF;

  SELECT coalesce(array_agg(p.key ORDER BY p.key),ARRAY[]::text[])
    INTO current_keys FROM public.role_permissions rp
    JOIN public.permissions p ON p.id=rp.permission_id WHERE rp.role_id=target_role;

  SELECT coalesce(array_agg(DISTINCT k ORDER BY k),ARRAY[]::text[])
    INTO desired_keys FROM unnest(desired_permission_keys) AS t(k);
  SELECT coalesce(array_agg(DISTINCT k ORDER BY k),ARRAY[]::text[])
    INTO expected_keys FROM unnest(expected_permission_keys) AS t(k);

  IF cardinality(desired_permission_keys)<>cardinality(desired_keys)
     OR cardinality(expected_permission_keys)<>cardinality(expected_keys)
     OR cardinality(desired_keys)>100 OR cardinality(expected_keys)>100 THEN
    RAISE EXCEPTION 'Duplicate or excessive permission keys'
      USING ERRCODE='22023';
  END IF;
  IF current_keys IS DISTINCT FROM expected_keys THEN
    RAISE EXCEPTION 'Permissions changed since the page was opened. Reload and review again'
      USING ERRCODE='40001';
  END IF;
  IF EXISTS(
    SELECT 1 FROM unnest(desired_keys) AS requested(k)
    LEFT JOIN public.permissions p ON p.key=requested.k
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Unknown permission requested' USING ERRCODE='22023';
  END IF;

  -- Only ADMIN may retain the delegated organization administration keys.
  -- The protected role ID stays unchanged even while its grants evolve.
  IF role_record.key IS DISTINCT FROM 'ADMIN'
     AND desired_keys && restricted_keys THEN
    RAISE EXCEPTION 'Administrative or destructive permissions cannot be granted to this profile'
      USING ERRCODE='42501';
  END IF;

  -- Prevent loss of the organization's role editor; the administrator may
  -- change operational grants but cannot remove core administrative controls.
  IF role_record.key='ADMIN' AND NOT protected_keys <@ desired_keys THEN
    RAISE EXCEPTION 'Core administrator permissions cannot be removed'
      USING ERRCODE='23514';
  END IF;

  SELECT coalesce(array_agg(k ORDER BY k),ARRAY[]::text[])
    INTO added_keys FROM unnest(desired_keys) AS t(k) WHERE NOT(k=ANY(current_keys));
  SELECT coalesce(array_agg(k ORDER BY k),ARRAY[]::text[])
    INTO removed_keys FROM unnest(current_keys) AS t(k) WHERE NOT(k=ANY(desired_keys));

  -- An administrator can delegate only permissions they currently possess,
  -- subject to subscription and organization restrictions.
  IF EXISTS(
    SELECT 1 FROM unnest(added_keys) AS t(k)
    WHERE NOT public.has_org_permission(target_org,t.k)
  ) THEN
    RAISE EXCEPTION 'You cannot delegate a permission you do not currently have'
      USING ERRCODE='42501';
  END IF;
  IF cardinality(added_keys)=0 AND cardinality(removed_keys)=0 THEN
    RETURN jsonb_build_object('added',0,'removed',0,'total',cardinality(current_keys));
  END IF;

  DELETE FROM public.role_permissions rp WHERE rp.role_id=target_role
    AND NOT EXISTS(
      SELECT 1 FROM public.permissions p
      WHERE p.id=rp.permission_id AND p.key=ANY(desired_keys)
    );
  INSERT INTO public.role_permissions(role_id,permission_id)
    SELECT target_role,p.id FROM public.permissions p WHERE p.key=ANY(added_keys)
    ON CONFLICT DO NOTHING;

  INSERT INTO public.audit_log
    (organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES(target_org,actor,'role.permissions_changed','ROLE',target_role,
      jsonb_build_object(
        'role_name',role_record.name,
        'role_key',role_record.key,
        'added',to_jsonb(added_keys),
        'removed',to_jsonb(removed_keys),
        'permission_count',cardinality(desired_keys)
      ));
  RETURN jsonb_build_object(
    'added',cardinality(added_keys),
    'removed',cardinality(removed_keys),
    'total',cardinality(desired_keys));
END;
$function$
;
