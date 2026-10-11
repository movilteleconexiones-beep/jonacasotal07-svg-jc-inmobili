-- Issue #68: controlled tenant onboarding by a verified platform administrator.
-- Intentionally not granted to anon. Never use the caller as the tenant owner.
BEGIN;

CREATE OR REPLACE FUNCTION public.platform_create_organization(
  p_name text, p_slug text, p_country text, p_owner uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  cp public.country_profiles%ROWTYPE;
  v_org uuid;
  v_member uuid;
  v_role uuid;
  v_role_key text;
  v_role_name text;
  v_pack uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501';
  END IF;
  IF p_owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id=p_owner
    AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL
    AND u.banned_until IS NULL
  ) THEN
    RAISE EXCEPTION 'Verified owner required' USING ERRCODE='22023';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 120
    OR p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR length(p_slug)>80 THEN
    RAISE EXCEPTION 'Invalid organization details' USING ERRCODE='22023';
  END IF;
  SELECT * INTO cp FROM public.country_profiles
    WHERE country_code = upper(p_country) AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unsupported country' USING ERRCODE='22023';
  END IF;

  -- The trigger enforces pending status and creates billing access/licensing.
  INSERT INTO public.organizations(name,slug,status)
    VALUES(btrim(p_name),p_slug,'TRIAL') RETURNING id INTO v_org;
  INSERT INTO public.organization_members(organization_id,user_id,status,joined_at)
    VALUES(v_org,p_owner,'ACTIVE',now()) RETURNING id INTO v_member;
  INSERT INTO public.organization_branding(organization_id,company_name,software_name)
    VALUES(v_org,btrim(p_name),'SISTEMA INMOBILIARIO JCO');
  INSERT INTO public.organization_settings(
    organization_id,default_currency,country,timezone,language,locale
  ) VALUES(v_org,cp.currency_code,cp.country_code,cp.timezone,cp.language,cp.locale);
  SELECT id INTO v_pack FROM public.compliance_packs
    WHERE country_code=cp.country_code AND status='ACTIVE'
    ORDER BY effective_date DESC NULLS LAST,created_at DESC LIMIT 1;
  INSERT INTO public.organization_compliance(organization_id,compliance_pack_id,status)
    VALUES(v_org,v_pack,CASE WHEN v_pack IS NULL THEN 'REVIEW_REQUIRED' ELSE 'ACTIVE' END);

  -- Every system role belongs exclusively to the newly created organization.
  FOREACH v_role_key IN ARRAY ARRAY['ORGANIZATION_OWNER','ADMIN','MANAGER','AGENT','CLIENT'] LOOP
    v_role_name := CASE v_role_key
      WHEN 'ORGANIZATION_OWNER' THEN 'Propietario'
      WHEN 'ADMIN' THEN 'Administrador'
      WHEN 'MANAGER' THEN 'Coordinador'
      WHEN 'AGENT' THEN 'Asesor'
      ELSE 'Cliente' END;
    INSERT INTO public.roles(organization_id,key,name,is_system_role,active)
      VALUES(v_org,v_role_key,v_role_name,true,true) RETURNING id INTO v_role;
    INSERT INTO public.role_permissions(role_id,permission_id)
      SELECT v_role,p.id FROM public.permissions p
      WHERE v_role_key='ORGANIZATION_OWNER'
      OR (v_role_key='ADMIN' AND p.key ~ '^(properties|clients|leads|appointments|deals|users|roles|settings|documents|owners|commissions|reports)\\.')
      OR (v_role_key='MANAGER' AND p.key IN (
        'properties.view','properties.create','properties.edit',
        'clients.view','clients.create','clients.edit',
        'leads.view','leads.assign','leads.edit',
        'appointments.view','appointments.create','appointments.edit',
        'deals.view','deals.create','deals.edit','deals.close',
        'documents.view','documents.upload','commissions.view','reports.view','users.view'))
      OR (v_role_key='AGENT' AND p.key IN (
        'properties.view','properties.create','properties.edit',
        'clients.view','clients.create','clients.edit',
        'leads.view','leads.edit','appointments.view','appointments.create',
        'appointments.edit','deals.view','deals.create','deals.edit',
        'documents.view','documents.upload'))
      OR (v_role_key='CLIENT' AND p.key IN (
        'properties.view','appointments.view','appointments.create',
        'documents.view','documents.upload'))
      ON CONFLICT DO NOTHING;
    IF v_role_key='ORGANIZATION_OWNER' THEN
      INSERT INTO public.member_roles(organization_member_id,role_id)
        VALUES(v_member,v_role);
    END IF;
  END LOOP;

  -- New tenants are not commercial accounts until verified payment or approval.
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_billing_access
    WHERE organization_id=v_org AND requires_payment=true AND is_test=false
      AND manual_access_until IS NULL
  ) THEN
    RAISE EXCEPTION 'Billing guard unavailable' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES(v_org,auth.uid(),'platform.organization_created','organization',v_org,
      jsonb_build_object('owner_user_id',p_owner,'country',cp.country_code,
        'commercial_activation','PENDING'));
  RETURN v_org;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_create_organization(text,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_create_organization(text,text,text,uuid)
  TO authenticated, service_role;
COMMIT;
