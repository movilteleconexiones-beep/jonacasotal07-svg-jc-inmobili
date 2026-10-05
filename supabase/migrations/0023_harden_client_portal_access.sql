-- Harden client/portal access so CLIENT users only see explicitly linked data.

-- Remove broad operational permissions from any existing CLIENT role.
delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id
  and r.key = 'CLIENT';

-- Future CLIENT roles receive no organization-wide permissions.
create or replace function public.apply_default_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key in ('ORGANIZATION_OWNER','ADMIN') then
    insert into public.role_permissions(role_id,permission_id)
    select new.id,id from public.permissions
    on conflict do nothing;
  elsif new.key = 'MANAGER' then
    insert into public.role_permissions(role_id,permission_id)
    select new.id,id from public.permissions
    where key in (
      'properties.view','properties.create','properties.edit',
      'clients.view','clients.create','clients.edit',
      'owners.view','owners.create','owners.edit',
      'leads.view','leads.assign','leads.edit',
      'appointments.view','appointments.create','appointments.edit',
      'deals.view','deals.create','deals.edit','deals.close',
      'documents.view','documents.upload',
      'commissions.view','commissions.create','commissions.edit',
      'reports.view','users.view'
    )
    on conflict do nothing;
  elsif new.key = 'AGENT' then
    insert into public.role_permissions(role_id,permission_id)
    select new.id,id from public.permissions
    where key in (
      'properties.view','properties.create','properties.edit',
      'clients.view','clients.create','clients.edit',
      'owners.view','owners.create','owners.edit',
      'leads.view','leads.edit',
      'appointments.view','appointments.create','appointments.edit',
      'deals.view','deals.create','deals.edit',
      'documents.view','documents.upload'
    )
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- Recreate onboarding so CLIENT relies exclusively on portal-specific RLS.
create or replace function public.create_organization_with_owner(
  org_name text,
  org_slug text,
  org_country_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(org_name)) < 2 then raise exception 'Organization name is required'; end if;
  if org_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Invalid organization slug'; end if;

  select * into cp from public.country_profiles
  where country_code = upper(org_country_code) and active = true;
  if cp.country_code is null then raise exception 'Unsupported country'; end if;

  insert into public.organizations(name,slug,status)
  values(trim(org_name),lower(trim(org_slug)),'ACTIVE')
  returning id into new_org_id;

  insert into public.organization_members(organization_id,user_id,status,joined_at)
  values(new_org_id,auth.uid(),'ACTIVE',now())
  returning id into new_member_id;

  insert into public.organization_branding(organization_id,company_name,software_name)
  values(new_org_id,trim(org_name),'Sistema Inmobiliario JCO');

  insert into public.organization_settings(
    organization_id,default_currency,country,timezone,language,locale
  ) values(
    new_org_id,cp.currency_code,cp.country_code,cp.timezone,cp.language,cp.locale
  );

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
  values(new_org_id,'ORGANIZATION_OWNER','Propietario','Control total de la inmobiliaria.',true,true)
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

  -- Trigger apply_default_role_permissions() assigns Owner/Admin/Manager/Agent.
  -- CLIENT intentionally receives no organization-wide role_permissions.

  insert into public.member_roles(organization_member_id,role_id)
  values(new_member_id,owner_role_id);

  insert into public.audit_log(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(
    new_org_id,auth.uid(),'organization.created','organization',new_org_id,
    jsonb_build_object('name',trim(org_name),'slug',lower(trim(org_slug)),'country',cp.country_code)
  );

  return new_org_id;
end;
$$;

-- Keep two-argument onboarding delegating to Colombia by default.
create or replace function public.create_organization_with_owner(
  org_name text,
  org_slug text
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.create_organization_with_owner(org_name,org_slug,'CO');
$$;

revoke all on function public.create_organization_with_owner(text,text,text) from public,anon;
revoke all on function public.create_organization_with_owner(text,text) from public,anon;
grant execute on function public.create_organization_with_owner(text,text,text) to authenticated;
grant execute on function public.create_organization_with_owner(text,text) to authenticated;

-- Portal links must reference records from the same organization.
drop policy if exists portal_links_insert on public.portal_access_links;
create policy portal_links_insert
on public.portal_access_links for insert to authenticated
with check (
  public.has_org_permission(organization_id,'users.edit')
  and created_by = (select auth.uid())
  and (
    contact_id is null
    or exists (
      select 1 from public.contacts c
      where c.id = contact_id and c.organization_id = organization_id
    )
  )
  and (
    owner_id is null
    or exists (
      select 1 from public.property_owners o
      where o.id = owner_id and o.organization_id = organization_id
    )
  )
);
