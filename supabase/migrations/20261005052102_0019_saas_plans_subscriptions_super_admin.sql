create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  admin_level text not null default 'SUPER_ADMIN'
    check (admin_level in ('PLATFORM_OWNER','SUPER_ADMIN')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  billing_cycle text not null default 'MONTHLY'
    check (billing_cycle in ('MONTHLY','ANNUAL','ONE_TIME','CUSTOM')),
  price numeric(16,2) not null default 0,
  currency text not null default 'USD',
  max_users integer,
  max_properties integer,
  max_storage_mb integer,
  ai_credits integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_features (
  plan_id uuid not null references public.plans(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default true,
  feature_limit numeric,
  primary key(plan_id,feature_key)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  status text not null default 'TRIAL'
    check (status in ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED','LIFETIME')),
  billing_mode text not null default 'SAAS_MONTHLY'
    check (billing_mode in ('SAAS_MONTHLY','SAAS_ANNUAL','LIFETIME','DEDICATED','CUSTOM')),
  started_at timestamptz not null default now(),
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancelled_at timestamptz,
  external_customer_id text,
  external_subscription_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_status on public.subscriptions(status);
create index if not exists idx_subscriptions_plan on public.subscriptions(plan_id);

insert into public.plans(code,name,description,billing_cycle,price,currency,max_users,max_properties,max_storage_mb,ai_credits)
values
  ('BASIC','Básico','Operación esencial para inmobiliarias pequeñas.','MONTHLY',0,'USD',5,200,2048,250),
  ('PRO','Profesional','CRM, equipo ampliado, reportes y automatización.','MONTHLY',0,'USD',25,2000,10240,2000),
  ('ENTERPRISE','Enterprise','Configuración avanzada, soporte dedicado y límites personalizados.','CUSTOM',0,'USD',null,null,null,null),
  ('LIFETIME','Licencia perpetua','Instalación dedicada con pago único.','ONE_TIME',0,'USD',null,null,null,null)
on conflict (code) do nothing;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = auth.uid()
      and active = true
  );
$$;

revoke all on function public.is_platform_admin() from public,anon;
grant execute on function public.is_platform_admin() to authenticated;

alter table public.platform_admins enable row level security;
alter table public.plans enable row level security;
alter table public.plan_features enable row level security;
alter table public.subscriptions enable row level security;

create policy platform_admins_self_read
on public.platform_admins for select
to authenticated
using (user_id = (select auth.uid()) or public.is_platform_admin());

create policy plans_authenticated_read
on public.plans for select
to authenticated
using (active = true or public.is_platform_admin());

create policy plans_platform_manage
on public.plans for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy plan_features_authenticated_read
on public.plan_features for select
to authenticated
using (
  exists (
    select 1 from public.plans p
    where p.id = plan_id and (p.active = true or public.is_platform_admin())
  )
);

create policy plan_features_platform_manage
on public.plan_features for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy subscriptions_org_read
on public.subscriptions for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_org_member(organization_id)
);

create policy subscriptions_platform_manage
on public.subscriptions for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create or replace function public.platform_list_organizations()
returns table(
  organization_id uuid,
  organization_name text,
  organization_slug text,
  organization_status text,
  created_at timestamptz,
  member_count bigint,
  property_count bigint,
  contact_count bigint,
  lead_count bigint,
  subscription_status text,
  billing_mode text,
  plan_code text,
  plan_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id,
    o.name,
    o.slug,
    o.status,
    o.created_at,
    (select count(*) from public.organization_members m where m.organization_id = o.id and m.status = 'ACTIVE'),
    (select count(*) from public.properties p where p.organization_id = o.id),
    (select count(*) from public.contacts c where c.organization_id = o.id),
    (select count(*) from public.leads l where l.organization_id = o.id),
    s.status,
    s.billing_mode,
    pl.code,
    pl.name
  from public.organizations o
  left join public.subscriptions s on s.organization_id = o.id
  left join public.plans pl on pl.id = s.plan_id
  where public.is_platform_admin()
  order by o.created_at desc;
$$;

revoke all on function public.platform_list_organizations() from public,anon;
grant execute on function public.platform_list_organizations() to authenticated;

create or replace function public.platform_set_subscription(
  target_org uuid,
  target_plan_code text,
  target_billing_mode text,
  target_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Permission denied';
  end if;

  select id into target_plan_id from public.plans
  where code = target_plan_code
  limit 1;

  if target_plan_id is null then
    raise exception 'Unknown plan';
  end if;

  insert into public.subscriptions(
    organization_id,plan_id,status,billing_mode,
    current_period_start,current_period_end,updated_at
  )
  values(
    target_org,target_plan_id,target_status,target_billing_mode,
    now(),
    case
      when target_billing_mode = 'SAAS_MONTHLY' then now() + interval '1 month'
      when target_billing_mode = 'SAAS_ANNUAL' then now() + interval '1 year'
      else null
    end,
    now()
  )
  on conflict (organization_id) do update set
    plan_id = excluded.plan_id,
    status = excluded.status,
    billing_mode = excluded.billing_mode,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    updated_at = now();

  update public.organizations
  set
    plan_id = target_plan_id,
    status = case
      when target_status = 'SUSPENDED' then 'SUSPENDED'
      when target_status in ('ACTIVE','LIFETIME','TRIAL') then 'ACTIVE'
      else status
    end,
    updated_at = now()
  where id = target_org;
end;
$$;

revoke all on function public.platform_set_subscription(uuid,text,text,text) from public,anon;
grant execute on function public.platform_set_subscription(uuid,text,text,text) to authenticated;
