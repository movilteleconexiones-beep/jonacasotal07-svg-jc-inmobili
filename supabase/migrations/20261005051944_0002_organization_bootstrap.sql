-- Bootstrap an organization with its first owner and default roles.
-- This RPC is intended for authenticated onboarding flows.

create or replace function public.create_organization_with_owner(
  org_name text,
  org_slug text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  new_member_id uuid;
  owner_role_id uuid;
  admin_role_id uuid;
  manager_role_id uuid;
  agent_role_id uuid;
  client_role_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if length(trim(org_name)) < 2 then
    raise exception 'Organization name is required';
  end if;

  if org_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Invalid organization slug';
  end if;

  insert into public.organizations (name, slug, status)
  values (trim(org_name), lower(trim(org_slug)), 'ACTIVE')
  returning id into new_org_id;

  insert into public.organization_members (
    organization_id,
    user_id,
    status,
    joined_at
  )
  values (
    new_org_id,
    auth.uid(),
    'ACTIVE',
    now()
  )
  returning id into new_member_id;

  insert into public.organization_branding (organization_id, company_name)
  values (new_org_id, trim(org_name));

  insert into public.organization_settings (organization_id)
  values (new_org_id);

  insert into public.roles (
    organization_id, key, name, description, is_system_role, active
  )
  values (
    new_org_id, 'ORGANIZATION_OWNER', 'Propietario',
    'Control total de la inmobiliaria.', true, true
  )
  returning id into owner_role_id;

  insert into public.roles (
    organization_id, key, name, description, is_system_role, active
  )
  values (
    new_org_id, 'ADMIN', 'Administrador',
    'Administración operativa de la inmobiliaria.', true, true
  )
  returning id into admin_role_id;

  insert into public.roles (
    organization_id, key, name, description, is_system_role, active
  )
  values (
    new_org_id, 'MANAGER', 'Coordinador',
    'Coordina asesores, clientes y operación comercial.', true, true
  )
  returning id into manager_role_id;

  insert into public.roles (
    organization_id, key, name, description, is_system_role, active
  )
  values (
    new_org_id, 'AGENT', 'Asesor',
    'Gestiona propiedades, leads, clientes, visitas y negocios asignados.', true, true
  )
  returning id into agent_role_id;

  insert into public.roles (
    organization_id, key, name, description, is_system_role, active
  )
  values (
    new_org_id, 'CLIENT', 'Cliente',
    'Acceso privado a su información, propiedades, visitas y documentos habilitados.', true, true
  )
  returning id into client_role_id;

  -- Owner gets every current permission.
  insert into public.role_permissions (role_id, permission_id)
  select owner_role_id, id
  from public.permissions
  on conflict do nothing;

  -- Admin: all operational permissions, including role assignment and settings.
  insert into public.role_permissions (role_id, permission_id)
  select admin_role_id, id
  from public.permissions
  on conflict do nothing;

  -- Manager: commercial operation and reports, but not destructive/system administration.
  insert into public.role_permissions (role_id, permission_id)
  select manager_role_id, id
  from public.permissions
  where key in (
    'properties.view','properties.create','properties.edit',
    'clients.view','clients.create','clients.edit',
    'leads.view','leads.assign','leads.edit',
    'appointments.view','appointments.create','appointments.edit',
    'deals.view','deals.create','deals.edit','deals.close',
    'documents.view','documents.upload',
    'commissions.view','reports.view',
    'users.view'
  )
  on conflict do nothing;

  -- Agent baseline.
  insert into public.role_permissions (role_id, permission_id)
  select agent_role_id, id
  from public.permissions
  where key in (
    'properties.view','properties.create','properties.edit',
    'clients.view','clients.create','clients.edit',
    'leads.view','leads.edit',
    'appointments.view','appointments.create','appointments.edit',
    'deals.view','deals.create','deals.edit',
    'documents.view','documents.upload'
  )
  on conflict do nothing;

  -- Client baseline is intentionally restrictive and can be expanded with overrides.
  insert into public.role_permissions (role_id, permission_id)
  select client_role_id, id
  from public.permissions
  where key in (
    'properties.view',
    'appointments.view','appointments.create',
    'documents.view','documents.upload'
  )
  on conflict do nothing;

  insert into public.member_roles (organization_member_id, role_id)
  values (new_member_id, owner_role_id);

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    new_org_id,
    auth.uid(),
    'organization.created',
    'organization',
    new_org_id,
    jsonb_build_object('name', trim(org_name), 'slug', lower(trim(org_slug)))
  );

  return new_org_id;
end;
$$;

grant execute on function public.create_organization_with_owner(text, text) to authenticated;
