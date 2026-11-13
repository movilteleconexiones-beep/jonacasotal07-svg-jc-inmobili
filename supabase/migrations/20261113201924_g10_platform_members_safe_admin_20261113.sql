-- G10: gestión central de membresías; instalación INDIVIDUAL, no db push histórico (#104).
-- La base de datos, no el frontend, verifica SuperAdmin.
CREATE OR REPLACE FUNCTION public.platform_get_organization_members(
  target_org uuid, page_limit integer DEFAULT 50, page_offset integer DEFAULT 0
)
RETURNS TABLE(
  member_id uuid, user_id uuid, display_name text, member_status text,
  joined_at timestamptz, assigned_roles text[], is_protected boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acceso reservado al SuperAdmin' USING ERRCODE = '42501';
  END IF;
  IF target_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = target_org) THEN
    RAISE EXCEPTION 'Inmobiliaria no encontrada' USING ERRCODE = '22023';
  END IF;
  IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 100
     OR page_offset IS NULL OR page_offset NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'Paginación inválida' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT m.id, m.user_id,
    coalesce(nullif(btrim(p.full_name), ''), 'Usuario ' || left(m.user_id::text, 8)),
    m.status, m.joined_at,
    coalesce((SELECT array_agg(r.name ORDER BY r.name)
      FROM public.member_roles mr
      JOIN public.roles r ON r.id = mr.role_id AND r.organization_id = m.organization_id
      WHERE mr.organization_member_id = m.id AND r.active), ARRAY[]::text[]),
    (m.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = m.user_id AND pa.active)
      OR (m.status = 'ACTIVE'
        AND EXISTS (
          SELECT 1 FROM public.member_roles mr
          JOIN public.roles r ON r.id = mr.role_id
          WHERE mr.organization_member_id = m.id
            AND r.organization_id = m.organization_id
            AND r.key = 'ORGANIZATION_OWNER' AND r.active
        )
        AND (SELECT count(DISTINCT om.user_id)
          FROM public.organization_members om
          JOIN public.member_roles mr ON mr.organization_member_id = om.id
          JOIN public.roles r ON r.id = mr.role_id AND r.organization_id = om.organization_id
          WHERE om.organization_id = m.organization_id AND om.status = 'ACTIVE'
            AND r.key = 'ORGANIZATION_OWNER' AND r.active) <= 1))
  FROM public.organization_members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.organization_id = target_org
  ORDER BY m.created_at, m.id
  LIMIT page_limit OFFSET page_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.platform_set_organization_member_status(
  target_org uuid, target_member uuid, target_status text, reason text
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  previous_status text;
  affected_user uuid;
  owner_count bigint;
  is_owner boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Acceso reservado al SuperAdmin' USING ERRCODE = '42501';
  END IF;
  IF target_org IS NULL OR target_member IS NULL OR target_status NOT IN ('ACTIVE','INACTIVE','SUSPENDED')
     OR target_status IS NULL THEN
    RAISE EXCEPTION 'Parámetros inválidos' USING ERRCODE = '22023';
  END IF;
  IF reason IS NULL OR length(btrim(reason)) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'Motivo obligatorio (10 a 500 caracteres)' USING ERRCODE = '22023';
  END IF;

  -- Serializar decisiones del panel central para la misma inmobiliaria.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('jco-platform-member:' || target_org::text, 0));
  -- Bloquear miembros activos para proteger la comprobación del último dueño.
  PERFORM 1 FROM public.organization_members om
    WHERE om.organization_id = target_org AND om.status = 'ACTIVE'
    ORDER BY om.id FOR UPDATE;

  SELECT m.status, m.user_id INTO previous_status, affected_user
    FROM public.organization_members m
    WHERE m.id = target_member AND m.organization_id = target_org
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membresía no encontrada en esa inmobiliaria' USING ERRCODE = 'P0002';
  END IF;
  IF affected_user = auth.uid()
     OR EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = affected_user AND pa.active) THEN
    RAISE EXCEPTION 'La cuenta del SuperAdmin está protegida' USING ERRCODE = '42501';
  END IF;
  IF previous_status = target_status THEN RETURN; END IF;

  IF previous_status = 'ACTIVE' AND target_status <> 'ACTIVE' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.member_roles mr
      JOIN public.roles r ON r.id = mr.role_id
      WHERE mr.organization_member_id = target_member
        AND r.organization_id = target_org
        AND r.key = 'ORGANIZATION_OWNER' AND r.active
    ) INTO is_owner;
    IF is_owner THEN
      SELECT count(DISTINCT om.user_id) INTO owner_count
      FROM public.organization_members om
      JOIN public.member_roles mr ON mr.organization_member_id = om.id
      JOIN public.roles r ON r.id = mr.role_id AND r.organization_id = om.organization_id
      WHERE om.organization_id = target_org AND om.status = 'ACTIVE'
        AND r.key = 'ORGANIZATION_OWNER' AND r.active;
      IF owner_count <= 1 THEN
        RAISE EXCEPTION 'No se puede suspender al último propietario activo' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  UPDATE public.organization_members m SET status = target_status
    WHERE m.id = target_member AND m.organization_id = target_org;
  INSERT INTO public.audit_log(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (target_org, auth.uid(), 'PLATFORM_MEMBER_STATUS_CHANGED', 'organization_member',
      target_member, pg_catalog.jsonb_build_object('previous_status', previous_status,
        'next_status', target_status, 'reason', btrim(reason)));
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_get_organization_members(uuid,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_set_organization_member_status(uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_get_organization_members(uuid,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_set_organization_member_status(uuid,uuid,text,text) TO authenticated;
