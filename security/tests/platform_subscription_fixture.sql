-- Disposable PostgreSQL CI database only; no production data.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.organizations(id uuid primary key,status text not null);
create table public.plans(id uuid primary key,code text unique not null,active boolean not null);
create table public.subscriptions(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null unique references public.organizations(id),
 plan_id uuid references public.plans(id),status text not null,billing_mode text not null,
 started_at timestamptz not null default now(),current_period_start timestamptz,current_period_end timestamptz,updated_at timestamptz not null default now()
);
create function public.is_platform_admin() returns boolean language sql stable as $$
 select auth.uid() = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
$$;
insert into public.organizations values
('11111111-1111-4111-8111-111111111111','ACTIVE'),
('22222222-2222-4222-8222-222222222222','INACTIVE');
insert into public.plans values
('33333333-3333-4333-8333-333333333333','BASIC',true),
('44444444-4444-4444-8444-444444444444','ENTERPRISE',true),
('55555555-5555-4555-8555-555555555555','LIFETIME',true),
('66666666-6666-4666-8666-666666666666','INACTIVE_PLAN',false);


-- Match Supabase API roles for isolated privilege tests.
do $roles$
begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then
   create role authenticated nologin;
 end if;
 if not exists(select 1 from pg_roles where rolname='anon') then
   create role anon nologin;
 end if;
end;
$roles$;
