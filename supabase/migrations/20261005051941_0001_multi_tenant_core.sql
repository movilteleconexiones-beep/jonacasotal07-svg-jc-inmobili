-- JC Inmobili / SaaS real-estate platform
-- Core multi-tenant schema for Supabase PostgreSQL.
-- Every business record must be scoped by organization_id.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  legal_name text,
  tax_id text,
  email text,
  phone text,
  whatsapp text,
  logo_url text,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','SUSPENDED','TRIAL','INACTIVE')),
  plan_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','SUSPENDED','INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'INVITED'
    check (status in ('INVITED','ACTIVE','SUSPENDED','INACTIVE')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  key text,
  name text not null,
  description text,
  is_system_role boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.member_roles (
  organization_member_id uuid not null references public.organization_members(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (organization_member_id, role_id)
);

create table if not exists public.member_permissions (
  organization_member_id uuid not null references public.organization_members(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  effect text not null check (effect in ('ALLOW','DENY')),
  primary key (organization_member_id, permission_id)
);

create table if not exists public.organization_branding (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  company_name text not null,
  logo_url text,
  favicon_url text,
  primary_color text,
  secondary_color text,
  website text,
  phone text,
  whatsapp text,
  email text,
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  default_currency text not null default 'MXN',
  country text not null default 'MX',
  timezone text not null default 'America/Mexico_City',
  language text not null default 'es',
  enable_rentals boolean not null default true,
  enable_sales boolean not null default true,
  enable_projects boolean not null default true,
  enable_ai boolean not null default true,
  enable_commissions boolean not null default true,
  enable_public_website boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_members_user on public.organization_members(user_id);
create index if not exists idx_members_org on public.organization_members(organization_id);
create index if not exists idx_roles_org on public.roles(organization_id);
create index if not exists idx_audit_org_created on public.audit_log(organization_id, created_at desc);

-- Permission catalogue
insert into public.permissions (key, description) values
  ('properties.view','Ver propiedades'),
  ('properties.create','Crear propiedades'),
  ('properties.edit','Editar propiedades'),
  ('properties.delete','Eliminar propiedades'),
  ('clients.view','Ver clientes'),
  ('clients.create','Crear clientes'),
  ('clients.edit','Editar clientes'),
  ('leads.view','Ver leads'),
  ('leads.assign','Asignar leads'),
  ('leads.edit','Editar leads'),
  ('appointments.view','Ver citas y visitas'),
  ('appointments.create','Crear citas y visitas'),
  ('appointments.edit','Editar citas y visitas'),
  ('deals.view','Ver negocios'),
  ('deals.create','Crear negocios'),
  ('deals.edit','Editar negocios'),
  ('deals.close','Cerrar negocios'),
  ('documents.view','Ver documentos'),
  ('documents.upload','Subir documentos'),
  ('commissions.view','Ver comisiones'),
  ('reports.view','Ver reportes'),
  ('users.view','Ver usuarios'),
  ('users.create','Crear usuarios'),
  ('users.edit','Editar usuarios'),
  ('users.disable','Desactivar usuarios'),
  ('roles.view','Ver roles'),
  ('roles.create','Crear roles'),
  ('roles.edit','Editar roles'),
  ('roles.assign','Asignar roles'),
  ('settings.view','Ver configuración'),
  ('settings.edit','Editar configuración')
on conflict (key) do nothing;

-- Helper: current user belongs to organization.
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
  );
$$;

-- Helper: effective permission = explicit DENY > explicit ALLOW > role permission.
create or replace function public.has_org_permission(target_org uuid, permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with membership as (
    select id
    from public.organization_members
    where organization_id = target_org
      and user_id = auth.uid()
      and status = 'ACTIVE'
    limit 1
  ),
  requested_permission as (
    select id
    from public.permissions
    where key = permission_key
    limit 1
  ),
  override_effect as (
    select mp.effect
    from public.member_permissions mp
    join membership m on m.id = mp.organization_member_id
    join requested_permission p on p.id = mp.permission_id
    limit 1
  ),
  role_grant as (
    select exists (
      select 1
      from public.member_roles mr
      join membership m on m.id = mr.organization_member_id
      join public.role_permissions rp on rp.role_id = mr.role_id
      join requested_permission p on p.id = rp.permission_id
    ) as granted
  )
  select case
    when exists (select 1 from override_effect where effect = 'DENY') then false
    when exists (select 1 from override_effect where effect = 'ALLOW') then true
    else coalesce((select granted from role_grant), false)
  end;
$$;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_permission(uuid, text) to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.member_roles enable row level security;
alter table public.member_permissions enable row level security;
alter table public.organization_branding enable row level security;
alter table public.organization_settings enable row level security;
alter table public.audit_log enable row level security;

-- Users can see organizations they actively belong to.
drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member
on public.organizations for select
to authenticated
using (public.is_org_member(id));

-- Users can read/update their own profile.
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Members can see active memberships inside organizations they belong to.
drop policy if exists members_select_org on public.organization_members;
create policy members_select_org
on public.organization_members for select
to authenticated
using (public.is_org_member(organization_id));

-- User administrators control membership through permissions.
drop policy if exists members_insert_admin on public.organization_members;
create policy members_insert_admin
on public.organization_members for insert
to authenticated
with check (public.has_org_permission(organization_id, 'users.create'));

drop policy if exists members_update_admin on public.organization_members;
create policy members_update_admin
on public.organization_members for update
to authenticated
using (public.has_org_permission(organization_id, 'users.edit'))
with check (public.has_org_permission(organization_id, 'users.edit'));

-- Permission catalogue is readable by authenticated users.
drop policy if exists permissions_select_authenticated on public.permissions;
create policy permissions_select_authenticated
on public.permissions for select
to authenticated
using (true);

-- Roles are visible to members of their organization.
drop policy if exists roles_select_org on public.roles;
create policy roles_select_org
on public.roles for select
to authenticated
using (organization_id is null or public.is_org_member(organization_id));

drop policy if exists roles_manage_admin on public.roles;
create policy roles_manage_admin
on public.roles for all
to authenticated
using (organization_id is not null and public.has_org_permission(organization_id, 'roles.edit'))
with check (organization_id is not null and public.has_org_permission(organization_id, 'roles.edit'));

-- Role permission assignments.
drop policy if exists role_permissions_select_org on public.role_permissions;
create policy role_permissions_select_org
on public.role_permissions for select
to authenticated
using (
  exists (
    select 1 from public.roles r
    where r.id = role_id
      and (r.organization_id is null or public.is_org_member(r.organization_id))
  )
);

drop policy if exists role_permissions_manage_admin on public.role_permissions;
create policy role_permissions_manage_admin
on public.role_permissions for all
to authenticated
using (
  exists (
    select 1 from public.roles r
    where r.id = role_id
      and r.organization_id is not null
      and public.has_org_permission(r.organization_id, 'roles.edit')
  )
)
with check (
  exists (
    select 1 from public.roles r
    where r.id = role_id
      and r.organization_id is not null
      and public.has_org_permission(r.organization_id, 'roles.edit')
  )
);

-- Member role assignments.
drop policy if exists member_roles_select_org on public.member_roles;
create policy member_roles_select_org
on public.member_roles for select
to authenticated
using (
  exists (
    select 1 from public.organization_members m
    where m.id = organization_member_id
      and public.is_org_member(m.organization_id)
  )
);

drop policy if exists member_roles_manage_admin on public.member_roles;
create policy member_roles_manage_admin
on public.member_roles for all
to authenticated
using (
  exists (
    select 1 from public.organization_members m
    where m.id = organization_member_id
      and public.has_org_permission(m.organization_id, 'roles.assign')
  )
)
with check (
  exists (
    select 1 from public.organization_members m
    where m.id = organization_member_id
      and public.has_org_permission(m.organization_id, 'roles.assign')
  )
);

-- Per-member permission overrides.
drop policy if exists member_permissions_select_org on public.member_permissions;
create policy member_permissions_select_org
on public.member_permissions for select
to authenticated
using (
  exists (
    select 1 from public.organization_members m
    where m.id = organization_member_id
      and public.is_org_member(m.organization_id)
  )
);

drop policy if exists member_permissions_manage_admin on public.member_permissions;
create policy member_permissions_manage_admin
on public.member_permissions for all
to authenticated
using (
  exists (
    select 1 from public.organization_members m
    where m.id = organization_member_id
      and public.has_org_permission(m.organization_id, 'roles.assign')
  )
)
with check (
  exists (
    select 1 from public.organization_members m
    where m.id = organization_member_id
      and public.has_org_permission(m.organization_id, 'roles.assign')
  )
);

-- Branding and settings are tenant-scoped.
drop policy if exists branding_select_org on public.organization_branding;
create policy branding_select_org
on public.organization_branding for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists branding_manage_org on public.organization_branding;
create policy branding_manage_org
on public.organization_branding for all
to authenticated
using (public.has_org_permission(organization_id, 'settings.edit'))
with check (public.has_org_permission(organization_id, 'settings.edit'));

drop policy if exists settings_select_org on public.organization_settings;
create policy settings_select_org
on public.organization_settings for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists settings_manage_org on public.organization_settings;
create policy settings_manage_org
on public.organization_settings for all
to authenticated
using (public.has_org_permission(organization_id, 'settings.edit'))
with check (public.has_org_permission(organization_id, 'settings.edit'));

-- Audit log is visible to members with reports permission.
drop policy if exists audit_select_org on public.audit_log;
create policy audit_select_org
on public.audit_log for select
to authenticated
using (
  organization_id is not null
  and public.has_org_permission(organization_id, 'reports.view')
);

-- Automatically create profile row on auth signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
