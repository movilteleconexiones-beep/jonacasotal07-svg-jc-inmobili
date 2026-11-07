-- LATAM localization and versioned compliance packs.

create table if not exists public.country_profiles (
  country_code text primary key,
  country_name text not null,
  locale text not null,
  currency_code text not null,
  currency_symbol text,
  timezone text not null,
  phone_country_code text,
  language text not null default 'es',
  property_terms jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.compliance_packs (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.country_profiles(country_code) on delete cascade,
  version text not null,
  title text not null,
  status text not null default 'REVIEW_REQUIRED'
    check (status in ('DRAFT','REVIEW_REQUIRED','VERIFIED','ACTIVE','RETIRED')),
  effective_date date,
  authority text,
  summary text,
  rules jsonb not null default '{}'::jsonb,
  source_urls jsonb not null default '[]'::jsonb,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(country_code, version)
);

create table if not exists public.organization_compliance (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  compliance_pack_id uuid references public.compliance_packs(id) on delete set null,
  status text not null default 'PENDING'
    check (status in ('PENDING','ACTIVE','REVIEW_REQUIRED','ACKNOWLEDGED')),
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.organization_settings
  add column if not exists locale text not null default 'es-CO';

insert into public.country_profiles
(country_code,country_name,locale,currency_code,currency_symbol,timezone,phone_country_code,language,property_terms)
values
('CO','Colombia','es-CO','COP','$','America/Bogota','+57','es','{"rent":"Arriendo","sale":"Venta","neighborhood":"Barrio","parking":"Parqueadero","bedroom":"Habitación"}'),
('MX','México','es-MX','MXN','$','America/Mexico_City','+52','es','{"rent":"Renta","sale":"Venta","neighborhood":"Colonia","parking":"Estacionamiento","bedroom":"Recámara"}'),
('PE','Perú','es-PE','PEN','S/','America/Lima','+51','es','{"rent":"Alquiler","sale":"Venta","neighborhood":"Distrito","parking":"Estacionamiento","bedroom":"Dormitorio"}'),
('CL','Chile','es-CL','CLP','$','America/Santiago','+56','es','{"rent":"Arriendo","sale":"Venta","neighborhood":"Comuna","parking":"Estacionamiento","bedroom":"Dormitorio"}'),
('AR','Argentina','es-AR','ARS','$','America/Argentina/Buenos_Aires','+54','es','{"rent":"Alquiler","sale":"Venta","neighborhood":"Barrio","parking":"Cochera","bedroom":"Dormitorio"}'),
('EC','Ecuador','es-EC','USD','$','America/Guayaquil','+593','es','{"rent":"Arriendo","sale":"Venta","neighborhood":"Sector","parking":"Parqueadero","bedroom":"Dormitorio"}'),
('PA','Panamá','es-PA','PAB','B/.','America/Panama','+507','es','{"rent":"Alquiler","sale":"Venta","neighborhood":"Sector","parking":"Estacionamiento","bedroom":"Recámara"}'),
('CR','Costa Rica','es-CR','CRC','₡','America/Costa_Rica','+506','es','{"rent":"Alquiler","sale":"Venta","neighborhood":"Distrito","parking":"Parqueo","bedroom":"Habitación"}'),
('GT','Guatemala','es-GT','GTQ','Q','America/Guatemala','+502','es','{"rent":"Alquiler","sale":"Venta","neighborhood":"Zona","parking":"Parqueo","bedroom":"Habitación"}'),
('DO','República Dominicana','es-DO','DOP','RD$','America/Santo_Domingo','+1','es','{"rent":"Alquiler","sale":"Venta","neighborhood":"Sector","parking":"Parqueo","bedroom":"Habitación"}'),
('UY','Uruguay','es-UY','UYU','$U','America/Montevideo','+598','es','{"rent":"Alquiler","sale":"Venta","neighborhood":"Barrio","parking":"Garaje","bedroom":"Dormitorio"}'),
('PY','Paraguay','es-PY','PYG','₲','America/Asuncion','+595','es','{"rent":"Alquiler","sale":"Venta","neighborhood":"Barrio","parking":"Estacionamiento","bedroom":"Dormitorio"}'),
('BO','Bolivia','es-BO','BOB','Bs','America/La_Paz','+591','es','{"rent":"Alquiler","sale":"Venta","neighborhood":"Zona","parking":"Garaje","bedroom":"Dormitorio"}'),
('HN','Honduras','es-HN','HNL','L','America/Tegucigalpa','+504','es','{"rent":"Alquiler","sale":"Venta","neighborhood":"Colonia","parking":"Estacionamiento","bedroom":"Habitación"}'),
('SV','El Salvador','es-SV','USD','$','America/El_Salvador','+503','es','{"rent":"Alquiler","sale":"Venta","neighborhood":"Colonia","parking":"Estacionamiento","bedroom":"Habitación"}'),
('NI','Nicaragua','es-NI','NIO','C$','America/Managua','+505','es','{"rent":"Alquiler","sale":"Venta","neighborhood":"Barrio","parking":"Estacionamiento","bedroom":"Habitación"}'),
('BR','Brasil','pt-BR','BRL','R$','America/Sao_Paulo','+55','pt','{"rent":"Aluguel","sale":"Venda","neighborhood":"Bairro","parking":"Vaga","bedroom":"Quarto"}')
on conflict (country_code) do update set
  country_name=excluded.country_name,
  locale=excluded.locale,
  currency_code=excluded.currency_code,
  currency_symbol=excluded.currency_symbol,
  timezone=excluded.timezone,
  phone_country_code=excluded.phone_country_code,
  language=excluded.language,
  property_terms=excluded.property_terms,
  active=true,
  updated_at=now();

insert into public.compliance_packs
(country_code,version,title,status,effective_date,authority,summary,rules,source_urls,reviewed_at)
values (
 'CO','2026.10',
 'Colombia - protección de datos y consumidor inmobiliario',
 'ACTIVE','2026-10-01',
 'Superintendencia de Industria y Comercio (SIC)',
 'Perfil inicial para datos personales y comercialización/publicidad inmobiliaria. Debe revisarse jurídicamente para cada operación.',
 '{
   "privacy":{"law":"Ley 1581 de 2012","requires_policy":true,"requires_authorization_basis":true,"authority":"SIC"},
   "housing_advertising":{"new_housing_price_currency":"COP","clear_truthful_complete_information":true,"reference":"Circular Externa 004 de 2024"},
   "consumer_protection":{"reference":"Ley 1480 de 2011","avoid_misleading_advertising":true}
 }'::jsonb,
 '[
   "https://sedeelectronica.sic.gov.co/transparencia/normativa/ley-estatutaria-1581-de-2012",
   "https://sedeelectronica.sic.gov.co/politica-de-tratamiento-de-datos-personales",
   "https://sedeelectronica.sic.gov.co/noticias/la-superintendencia-expidio-circular-externa-sobre-la-promocion-publicidad-y-comercializacion-de-proyectos-constructivos-destinados-vivienda"
 ]'::jsonb,
 now()
)
on conflict (country_code,version) do update set
  status=excluded.status,
  title=excluded.title,
  authority=excluded.authority,
  summary=excluded.summary,
  rules=excluded.rules,
  source_urls=excluded.source_urls,
  reviewed_at=excluded.reviewed_at;

alter table public.country_profiles enable row level security;
alter table public.compliance_packs enable row level security;
alter table public.organization_compliance enable row level security;

drop policy if exists country_profiles_read on public.country_profiles;
create policy country_profiles_read on public.country_profiles
for select to authenticated using (active = true);

drop policy if exists compliance_packs_read on public.compliance_packs;
create policy compliance_packs_read on public.compliance_packs
for select to authenticated using (status in ('VERIFIED','ACTIVE','REVIEW_REQUIRED'));

drop policy if exists organization_compliance_read on public.organization_compliance;
create policy organization_compliance_read on public.organization_compliance
for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists organization_compliance_update on public.organization_compliance;
create policy organization_compliance_update on public.organization_compliance
for update to authenticated
using (public.has_org_permission(organization_id,'settings.edit'))
with check (public.has_org_permission(organization_id,'settings.edit'));

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
  values(new_org_id,trim(org_name),'JC Inmobili Software');

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
  values(new_org_id,'CLIENT','Cliente','Acceso privado a su información y documentos habilitados.',true,true)
  returning id into client_role_id;

  insert into public.role_permissions(role_id,permission_id)
  select owner_role_id,id from public.permissions on conflict do nothing;
  insert into public.role_permissions(role_id,permission_id)
  select admin_role_id,id from public.permissions on conflict do nothing;

  insert into public.role_permissions(role_id,permission_id)
  select manager_role_id,id from public.permissions where key in (
    'properties.view','properties.create','properties.edit','clients.view','clients.create','clients.edit',
    'leads.view','leads.assign','leads.edit','appointments.view','appointments.create','appointments.edit',
    'deals.view','deals.create','deals.edit','deals.close','documents.view','documents.upload',
    'commissions.view','reports.view','users.view'
  ) on conflict do nothing;

  insert into public.role_permissions(role_id,permission_id)
  select agent_role_id,id from public.permissions where key in (
    'properties.view','properties.create','properties.edit','clients.view','clients.create','clients.edit',
    'leads.view','leads.edit','appointments.view','appointments.create','appointments.edit',
    'deals.view','deals.create','deals.edit','documents.view','documents.upload'
  ) on conflict do nothing;

  insert into public.role_permissions(role_id,permission_id)
  select client_role_id,id from public.permissions where key in (
    'properties.view','appointments.view','appointments.create','documents.view','documents.upload'
  ) on conflict do nothing;

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
grant execute on function public.create_organization_with_owner(text,text,text) to authenticated;
revoke all on function public.create_organization_with_owner(text,text) from public,anon;
grant execute on function public.create_organization_with_owner(text,text) to authenticated;
