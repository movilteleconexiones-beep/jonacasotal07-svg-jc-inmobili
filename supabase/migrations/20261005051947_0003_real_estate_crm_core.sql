-- Core real-estate and CRM domain tables.

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  title text not null,
  description text,
  operation_type text not null check (operation_type in ('SALE','RENT','SALE_OR_RENT','ADMINISTRATION')),
  property_type text not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','AVAILABLE','RESERVED','NEGOTIATION','SOLD','RENTED','INACTIVE')),
  price numeric(16,2),
  currency text not null default 'MXN',
  country text,
  state text,
  city text,
  neighborhood text,
  address text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  bedrooms numeric(5,2),
  bathrooms numeric(5,2),
  parking_spaces integer,
  built_area numeric(12,2),
  private_area numeric(12,2),
  lot_area numeric(12,2),
  administration_fee numeric(16,2),
  featured boolean not null default false,
  assigned_agent_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text not null,
  last_name text,
  email text,
  phone text,
  whatsapp text,
  source text not null default 'MANUAL'
    check (source in ('WEBSITE','WHATSAPP','INSTAGRAM','FACEBOOK','PORTAL','REFERRAL','PHONE','MANUAL','OTHER')),
  assigned_agent_id uuid references auth.users(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  assigned_agent_id uuid references auth.users(id) on delete set null,
  status text not null default 'NEW'
    check (status in ('NEW','CONTACTED','QUALIFIED','VISIT_SCHEDULED','NEGOTIATION','WON','LOST')),
  priority text not null default 'MEDIUM'
    check (priority in ('LOW','MEDIUM','HIGH','URGENT')),
  budget_min numeric(16,2),
  budget_max numeric(16,2),
  desired_operation text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  assigned_user_id uuid references auth.users(id) on delete set null,
  appointment_type text not null default 'VISIT',
  status text not null default 'SCHEDULED'
    check (status in ('SCHEDULED','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  assigned_agent_id uuid references auth.users(id) on delete set null,
  operation_type text not null,
  stage text not null default 'INTEREST'
    check (stage in ('INTEREST','VISIT','OFFER','NEGOTIATION','DOCUMENTATION','CLOSING','WON','LOST')),
  asking_price numeric(16,2),
  offered_price numeric(16,2),
  final_price numeric(16,2),
  commission_amount numeric(16,2),
  commission_percentage numeric(8,4),
  expected_close_date date,
  closed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  type text not null
    check (type in ('CALL','WHATSAPP','EMAIL','NOTE','MEETING','VISIT','FOLLOW_UP')),
  description text,
  scheduled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  feature text not null,
  provider text not null default 'google',
  model text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost numeric(14,6),
  created_at timestamptz not null default now()
);

create index if not exists idx_properties_org on public.properties(organization_id);
create index if not exists idx_properties_org_status on public.properties(organization_id, status);
create index if not exists idx_contacts_org on public.contacts(organization_id);
create index if not exists idx_leads_org_status on public.leads(organization_id, status);
create index if not exists idx_appointments_org_start on public.appointments(organization_id, starts_at);
create index if not exists idx_deals_org_stage on public.deals(organization_id, stage);
create index if not exists idx_activities_org_created on public.activities(organization_id, created_at desc);
create index if not exists idx_ai_usage_org_created on public.ai_usage(organization_id, created_at desc);

alter table public.properties enable row level security;
alter table public.contacts enable row level security;
alter table public.leads enable row level security;
alter table public.appointments enable row level security;
alter table public.deals enable row level security;
alter table public.activities enable row level security;
alter table public.ai_usage enable row level security;

-- Properties
create policy properties_select on public.properties for select to authenticated
using (public.has_org_permission(organization_id, 'properties.view'));
create policy properties_insert on public.properties for insert to authenticated
with check (public.has_org_permission(organization_id, 'properties.create'));
create policy properties_update on public.properties for update to authenticated
using (public.has_org_permission(organization_id, 'properties.edit'))
with check (public.has_org_permission(organization_id, 'properties.edit'));
create policy properties_delete on public.properties for delete to authenticated
using (public.has_org_permission(organization_id, 'properties.delete'));

-- Contacts / clients
create policy contacts_select on public.contacts for select to authenticated
using (public.has_org_permission(organization_id, 'clients.view'));
create policy contacts_insert on public.contacts for insert to authenticated
with check (public.has_org_permission(organization_id, 'clients.create'));
create policy contacts_update on public.contacts for update to authenticated
using (public.has_org_permission(organization_id, 'clients.edit'))
with check (public.has_org_permission(organization_id, 'clients.edit'));

-- Leads
create policy leads_select on public.leads for select to authenticated
using (public.has_org_permission(organization_id, 'leads.view'));
create policy leads_insert on public.leads for insert to authenticated
with check (
  public.has_org_permission(organization_id, 'leads.edit')
  or public.has_org_permission(organization_id, 'clients.create')
);
create policy leads_update on public.leads for update to authenticated
using (public.has_org_permission(organization_id, 'leads.edit'))
with check (public.has_org_permission(organization_id, 'leads.edit'));

-- Appointments
create policy appointments_select on public.appointments for select to authenticated
using (public.has_org_permission(organization_id, 'appointments.view'));
create policy appointments_insert on public.appointments for insert to authenticated
with check (public.has_org_permission(organization_id, 'appointments.create'));
create policy appointments_update on public.appointments for update to authenticated
using (public.has_org_permission(organization_id, 'appointments.edit'))
with check (public.has_org_permission(organization_id, 'appointments.edit'));

-- Deals
create policy deals_select on public.deals for select to authenticated
using (public.has_org_permission(organization_id, 'deals.view'));
create policy deals_insert on public.deals for insert to authenticated
with check (public.has_org_permission(organization_id, 'deals.create'));
create policy deals_update on public.deals for update to authenticated
using (public.has_org_permission(organization_id, 'deals.edit'))
with check (public.has_org_permission(organization_id, 'deals.edit'));

-- Activity history follows CRM visibility.
create policy activities_select on public.activities for select to authenticated
using (
  public.has_org_permission(organization_id, 'clients.view')
  or public.has_org_permission(organization_id, 'leads.view')
  or public.has_org_permission(organization_id, 'deals.view')
);
create policy activities_insert on public.activities for insert to authenticated
with check (public.is_org_member(organization_id));

-- AI usage: members may create their own usage; reporting permission can read totals.
create policy ai_usage_insert on public.ai_usage for insert to authenticated
with check (
  public.is_org_member(organization_id)
  and (user_id is null or user_id = auth.uid())
);
create policy ai_usage_select on public.ai_usage for select to authenticated
using (public.has_org_permission(organization_id, 'reports.view'));
