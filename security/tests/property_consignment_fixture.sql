\set ON_ERROR_STOP on

do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.organizations(id uuid primary key, name text not null, status text not null);
create schema jco_private;
create table public.consignment_test_operational_access(organization_id uuid primary key, allowed boolean not null);
create function jco_private.operational_access(target_org uuid) returns boolean language sql stable security definer
set search_path to '' as $body$
  select exists (select 1 from public.consignment_test_operational_access a where a.organization_id=target_org and a.allowed)
$body$;
revoke all on table public.consignment_test_operational_access from anon, authenticated, public;
create table public.organization_settings(organization_id uuid primary key references public.organizations,
  country text, default_currency text, enable_public_website boolean);
create table public.consignment_test_permissions(user_id uuid, organization_id uuid, permission_key text);
create function public.has_org_permission(target_org uuid, permission_key text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.consignment_test_permissions p
    where p.user_id=auth.uid() and p.organization_id=target_org and p.permission_key=$2);
$$;
create table public.properties(
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations,
  code text, title text, description text, operation_type text, property_type text, status text,
  price numeric(16,2), currency text, country text, state text, city text, neighborhood text,
  bedrooms numeric(5,2), bathrooms numeric(5,2), parking_spaces integer,
  built_area numeric(12,2), lot_area numeric(12,2), administration_fee numeric(16,2),
  created_by uuid references auth.users, unique(organization_id,code)
);
create table public.contacts(id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations,
  first_name text, phone text, source text check(source in ('WEBSITE','MANUAL')), notes text, created_by uuid references auth.users);
create table public.leads(id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations,
  contact_id uuid references public.contacts, property_id uuid references public.properties,
  status text, priority text, desired_operation text, notes text, created_by uuid references auth.users);
alter table public.properties enable row level security;
alter table public.contacts enable row level security;
alter table public.leads enable row level security;
create policy "Permitir lectura publica de propiedades" on public.properties for select using(true);
create policy properties_read on public.properties for select to authenticated using(public.has_org_permission(organization_id,'properties.view'));

insert into public.organizations values('11111111-1111-1111-1111-111111111111','Tenant A','ACTIVE'),
  ('22222222-2222-2222-2222-222222222222','Tenant B','ACTIVE'),
  ('33333333-3333-3333-3333-333333333333','Disabled','INACTIVE');
insert into public.consignment_test_operational_access values
 ('11111111-1111-1111-1111-111111111111',true),
 ('22222222-2222-2222-2222-222222222222',false),
 ('33333333-3333-3333-3333-333333333333',false);
insert into auth.users values('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc');
insert into public.consignment_test_permissions
  select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,p
  from unnest(array['properties.view','properties.create','properties.edit','clients.view','clients.create','leads.edit']) p;
insert into public.consignment_test_permissions values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','properties.view'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','clients.view'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','11111111-1111-1111-1111-111111111111','properties.view');

create function public.consignment_test_payload() returns jsonb language sql immutable as $$
  select '{"title":"Apartamento de prueba","operation_type":"SALE","property_type":"APARTMENT", "price":250000000,
  "lot_area":65.25,"built_area":65.25,"bedrooms":0,"bathrooms":1.5,"parking_spaces":0,"administration_fee":0,
  "construction_year":null,"state":"Antioquia","city":"Medellín","neighborhood":"","description":"",
  "owner_name":"Prueba técnica","owner_phone":"+57 000 000 0000","contact_consent":true}'::jsonb;
$$;
create function public.consignment_test_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',label; end if; end;
$$;
