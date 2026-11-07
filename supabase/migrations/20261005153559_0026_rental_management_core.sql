-- INMOJCO ERP: Core de administración de arriendos
-- No modifica módulos existentes.

create table if not exists public.leases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  owner_id uuid references public.property_owners(id) on delete restrict,
  tenant_id uuid references public.contacts(id) on delete restrict,
  contract_number text,
  start_date date not null,
  end_date date,
  monthly_rent numeric(16,2) not null default 0,
  payment_day integer check (payment_day between 1 and 31),
  adjustment_type text default 'ANNUAL',
  adjustment_percentage numeric(8,2),
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','RENEWAL','EXPIRED','FINISHED','CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rent_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lease_id uuid not null references public.leases(id) on delete cascade,
  period_month date not null,
  expected_amount numeric(16,2) not null default 0,
  paid_amount numeric(16,2) not null default 0,
  paid_at timestamptz,
  status text not null default 'PENDING' check (status in ('PENDING','PAID','PARTIAL','LATE','CANCELLED')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.owner_statements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lease_id uuid not null references public.leases(id) on delete cascade,
  owner_id uuid references public.property_owners(id) on delete restrict,
  period_month date not null,
  gross_income numeric(16,2) not null default 0,
  commission_amount numeric(16,2) not null default 0,
  tax_amount numeric(16,2) not null default 0,
  other_deductions numeric(16,2) not null default 0,
  net_amount numeric(16,2) not null default 0,
  status text not null default 'DRAFT' check(status in ('DRAFT','GENERATED','PAID')),
  created_at timestamptz not null default now()
);

create table if not exists public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  reported_by uuid references auth.users(id),
  title text not null,
  description text,
  estimated_cost numeric(16,2) default 0,
  status text not null default 'OPEN' check(status in ('OPEN','APPROVED','IN_PROGRESS','DONE','CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leases_org on public.leases(organization_id);
create index if not exists idx_rent_payments_lease on public.rent_payments(lease_id);
create index if not exists idx_owner_statements_owner on public.owner_statements(owner_id);
create index if not exists idx_maintenance_property on public.maintenance_requests(property_id);

alter table public.leases enable row level security;
alter table public.rent_payments enable row level security;
alter table public.owner_statements enable row level security;
alter table public.maintenance_requests enable row level security;

create policy leases_org_access on public.leases for all to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy rent_payments_org_access on public.rent_payments for all to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy owner_statements_org_access on public.owner_statements for all to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy maintenance_org_access on public.maintenance_requests for all to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

insert into public.permissions(key,description) values
('leases.view','Ver contratos de arrendamiento'),
('leases.create','Crear contratos de arrendamiento'),
('leases.edit','Editar contratos de arrendamiento'),
('rent_payments.view','Consultar pagos de arriendo'),
('rent_payments.create','Registrar pagos de arriendo'),
('owner_statements.view','Consultar liquidaciones de propietarios'),
('owner_statements.create','Crear liquidaciones'),
('maintenance.view','Consultar mantenimientos'),
('maintenance.create','Crear mantenimientos'),
('maintenance.edit','Editar mantenimientos')
on conflict (key) do nothing;