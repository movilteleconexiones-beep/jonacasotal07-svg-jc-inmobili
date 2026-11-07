-- Owner-only public URL edit. Operational permissions and billing remain unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.set_organization_public_slug(
  target_org uuid,
  desired_slug text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  normalized text := lower(btrim(desired_slug));
  current_slug text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión' USING ERRCODE='42501';
  END IF;

  IF normalized IS NULL
     OR length(normalized) NOT BETWEEN 2 AND 60
     OR normalized !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     OR normalized IN ('app','api','auth','admin','super-admin','inmobiliaria','login','registro','www','root','jco','inmojco')
  THEN
    RAISE EXCEPTION 'La URL debe tener 2 a 60 caracteres: letras, números y guiones; algunos nombres están reservados'
      USING ERRCODE='22023';
  END IF;

  -- An authenticated ORGANIZATION_OWNER of this exact organization can edit
  -- its URL; merely being Platform Admin or belonging to another tenant
  -- never satisfies this guard.
  SELECT o.slug INTO current_slug
    FROM public.organizations o
    JOIN public.organization_members om
      ON om.organization_id=o.id AND om.user_id=auth.uid() AND om.status='ACTIVE'
    JOIN public.member_roles mr ON mr.organization_member_id=om.id
    JOIN public.roles r
      ON r.id=mr.role_id AND r.organization_id=o.id
     AND r.key='ORGANIZATION_OWNER' AND r.active IS TRUE
   WHERE o.id=target_org AND o.status='ACTIVE'
   FOR UPDATE OF o;
  IF current_slug IS NULL THEN
    RAISE EXCEPTION 'Solo el propietario activo puede modificar la URL de esta inmobiliaria'
      USING ERRCODE='42501';
  END IF;

  IF current_slug=normalized THEN RETURN normalized; END IF;

  UPDATE public.organizations
     SET slug=normalized, updated_at=now()
   WHERE id=target_org;

  INSERT INTO public.audit_log(
    organization_id,actor_user_id,action,entity_type,entity_id,metadata
  ) VALUES (
    target_org,auth.uid(),'organization.public_slug.updated','organization',target_org,
    jsonb_build_object('previous_slug',current_slug,'new_slug',normalized)
  );
  RETURN normalized;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Esta URL ya pertenece a otra inmobiliaria'
      USING ERRCODE='23505';
END;
$function$;

REVOKE ALL ON FUNCTION public.set_organization_public_slug(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_organization_public_slug(uuid,text) TO authenticated;
COMMENT ON FUNCTION public.set_organization_public_slug(uuid,text)
 IS 'Allows a verified active organization owner to edit only that tenant public slug; changes are audited.';

COMMIT;
