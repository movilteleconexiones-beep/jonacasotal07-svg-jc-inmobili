CREATE OR REPLACE FUNCTION public.create_organization_with_owner(org_name text, org_slug text, org_country_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cp public.country_profiles%rowtype;
  new_org_id uuid;
  new_member_id uuid;
  owner_role_id uuid;
  admin_role_id uuid;
  manager_role_id uuid;
  agent_role_id uuid;
  client_role_id uuid;
  active_pack_id uuid;
  active_terms_id uuid;
  basic_plan_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(org_name)) < 2 then raise exception 'Organization name is required'; end if;
  if org_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Invalid organization slug'; end if;

  select * into cp from public.country_profiles
  where country_code = upper(org_country_code) and active = true;
  if cp.country_code is null then raise exception 'Unsupported country'; end if;

  select id into active_terms_id
  from public.license_terms_versions
  where active = true
  order by effective_date desc, created_at desc
  limit 1;

  select id into basic_plan_id
  from public.plans
  where code = 'BASIC' and active = true
  limit 1;

  insert into public.organizations(name,slug,status,plan_id)
  values(trim(org_name),lower(trim(org_slug)),'ACTIVE',basic_plan_id)
  returning id into new_org_id;

  insert into public.organization_members(organization_id,user_id,status,joined_at)
  values(new_org_id,auth.uid(),'ACTIVE',now())
  returning id into new_member_id;

  -- SaaS keeps INMOJCO/JCO as software brand while the customer company name is independent.
  insert into public.organization_branding(organization_id,company_name,software_name)
  values(new_org_id,trim(org_name),'Sistema Inmobiliario JCO');

  insert into public.organization_settings(
    organization_id,default_currency,country,timezone,language,locale
  ) values(
    new_org_id,cp.currency_code,cp.country_code,cp.timezone,cp.language,cp.locale
  );

  insert into public.organization_licenses(
    organization_id,license_type,status,operational_control_full,
    copyright_transferred,resale_allowed,sublicensing_allowed,
    redistribution_allowed,white_label_allowed,terms_version_id
  ) values(
    new_org_id,'SAAS','ACTIVE',false,false,false,false,false,false,active_terms_id
  ) on conflict (organization_id) do nothing;

  if basic_plan_id is not null and to_regclass('public.organization_billing_access') is null then
    insert into public.subscriptions(
      organization_id,plan_id,status,billing_mode,
      started_at,current_period_start,current_period_end,trial_ends_at
    ) values(
      new_org_id,basic_plan_id,'TRIAL','SAAS_MONTHLY',
      now(),now(),now()+interval '14 days',now()+interval '14 days'
    )
    on conflict (organization_id) do nothing;
  end if;

  select id into active_pack_id from public.compliance_packs
  where country_code = cp.country_code and status = 'ACTIVE'
  order by effective_date desc nulls last, created_at desc
  limit 1;

  insert into public.organization_compliance(organization_id,compliance_pack_id,status)
  values(
    new_org_id,
    active_pack_id,
    case when active_pack_id is null then 'REVIEW_REQUIRED' else 'ACTIVE' end
  );

  insert into public.roles(organization_id,key,name,description,is_system_role,active)
  values(new_org_id,'ORGANIZATION_OWNER','Propietario','Control de la operación de la organización según la modalidad de licencia.',true,true)
  returning id into owner_role_id;

  insert into public.roles(organization_id,key,name,description,is_system_role,active)
  values(new_org_id,'ADMIN','Administrador','Administración operativa de la inmobiliaria.',true,true)
  returning id into admin_role_id;

  insert into public.roles(organization_id,key,name,description,is_system_role,active)
  values(new_org_id,'MANAGER','Coordinador','Coordina asesores, clientes y operación comercial.',true,true)
  returning id into manager_role_id;

  insert into public.roles(organization_id,key,name,description,is_system_role,active)
  values(new_org_id,'AGENT','Asesor','Gestiona propiedades, leads, clientes, visitas y negocios asignados.',true,true)
  returning id into agent_role_id;

  insert into public.roles(organization_id,key,name,description,is_system_role,active)
  values(new_org_id,'CLIENT','Cliente','Acceso privado únicamente a información vinculada mediante el portal.',true,true)
  returning id into client_role_id;

  insert into public.member_roles(organization_member_id,role_id)
  values(new_member_id,owner_role_id);

  insert into public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(
    new_org_id,auth.uid(),'organization.created','organization',new_org_id,
    jsonb_build_object(
      'name',trim(org_name),
      'slug',lower(trim(org_slug)),
      'country',cp.country_code,
      'license_type','SAAS',
      'terms_acceptance_required',true
    )
  );

  return new_org_id;
end;
$function$
