insert into public.permissions(key,description) values
  ('owners.view','Ver propietarios'),
  ('owners.create','Crear propietarios'),
  ('owners.edit','Editar propietarios'),
  ('commissions.create','Crear comisiones'),
  ('commissions.edit','Editar comisiones'),
  ('documents.delete','Eliminar documentos')
on conflict (key) do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id
from public.roles r
join public.permissions p on p.key in (
  'owners.view','owners.create','owners.edit',
  'commissions.create','commissions.edit',
  'documents.delete'
)
where r.key in ('ORGANIZATION_OWNER','ADMIN')
on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id
from public.roles r
join public.permissions p on p.key in (
  'owners.view','owners.create','owners.edit',
  'commissions.create','commissions.edit'
)
where r.key = 'MANAGER'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id
from public.roles r
join public.permissions p on p.key in (
  'owners.view','owners.create','owners.edit'
)
where r.key = 'AGENT'
on conflict do nothing;

create table if not exists public.property_owners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text not null,
  last_name text,
  document_type text,
  document_number text,
  email text,
  phone text,
  whatsapp text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.property_ownerships (
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references public.property_owners(id) on delete cascade,
  ownership_percentage numeric(7,4) not null default 100
    check (ownership_percentage > 0 and ownership_percentage <= 100),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key(property_id,owner_id)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null
    check (entity_type in ('GENERAL','PROPERTY','OWNER','CONTACT','LEAD','DEAL','USER')),
  entity_id uuid,
  document_type text not null default 'OTHER',
  title text not null,
  storage_bucket text not null default 'organization-documents',
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  expires_at date,
  notes text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  beneficiary_user_id uuid references auth.users(id) on delete set null,
  commission_type text not null default 'AGENT'
    check (commission_type in ('AGENT','CAPTOR','COORDINATOR','REFERRAL','COMPANY','OTHER')),
  percentage numeric(8,4),
  amount numeric(16,2),
  currency text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING','APPROVED','PAYABLE','PAID','CANCELLED')),
  due_date date,
  paid_at timestamptz,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_property_owners_org on public.property_owners(organization_id);
create index if not exists idx_ownership_owner on public.property_ownerships(owner_id);
create index if not exists idx_documents_org_entity on public.documents(organization_id,entity_type,entity_id);
create index if not exists idx_documents_uploaded_by on public.documents(uploaded_by);
create index if not exists idx_commissions_org_status on public.commissions(organization_id,status);
create index if not exists idx_commissions_deal on public.commissions(deal_id);
create index if not exists idx_commissions_beneficiary on public.commissions(beneficiary_user_id);

alter table public.property_owners enable row level security;
alter table public.property_ownerships enable row level security;
alter table public.documents enable row level security;
alter table public.commissions enable row level security;

create policy owners_select on public.property_owners for select to authenticated
using (public.has_org_permission(organization_id,'owners.view'));
create policy owners_insert on public.property_owners for insert to authenticated
with check (public.has_org_permission(organization_id,'owners.create'));
create policy owners_update on public.property_owners for update to authenticated
using (public.has_org_permission(organization_id,'owners.edit'))
with check (public.has_org_permission(organization_id,'owners.edit'));

create policy ownerships_select on public.property_ownerships for select to authenticated
using (
  exists (
    select 1 from public.properties p
    where p.id = property_id
      and public.has_org_permission(p.organization_id,'owners.view')
  )
);
create policy ownerships_insert on public.property_ownerships for insert to authenticated
with check (
  exists (
    select 1 from public.properties p
    join public.property_owners o on o.id = owner_id
    where p.id = property_id
      and p.organization_id = o.organization_id
      and public.has_org_permission(p.organization_id,'owners.edit')
  )
);
create policy ownerships_update on public.property_ownerships for update to authenticated
using (
  exists (
    select 1 from public.properties p
    where p.id = property_id
      and public.has_org_permission(p.organization_id,'owners.edit')
  )
)
with check (
  exists (
    select 1 from public.properties p
    where p.id = property_id
      and public.has_org_permission(p.organization_id,'owners.edit')
  )
);
create policy ownerships_delete on public.property_ownerships for delete to authenticated
using (
  exists (
    select 1 from public.properties p
    where p.id = property_id
      and public.has_org_permission(p.organization_id,'owners.edit')
  )
);

create policy documents_select on public.documents for select to authenticated
using (public.has_org_permission(organization_id,'documents.view'));
create policy documents_insert on public.documents for insert to authenticated
with check (
  public.has_org_permission(organization_id,'documents.upload')
  and uploaded_by = (select auth.uid())
);
create policy documents_delete on public.documents for delete to authenticated
using (public.has_org_permission(organization_id,'documents.delete'));

create policy commissions_select on public.commissions for select to authenticated
using (public.has_org_permission(organization_id,'commissions.view'));
create policy commissions_insert on public.commissions for insert to authenticated
with check (public.has_org_permission(organization_id,'commissions.create'));
create policy commissions_update on public.commissions for update to authenticated
using (public.has_org_permission(organization_id,'commissions.edit'))
with check (public.has_org_permission(organization_id,'commissions.edit'));

insert into storage.buckets(id,name,public,file_size_limit)
values ('organization-documents','organization-documents',false,52428800)
on conflict (id) do update set public=false,file_size_limit=52428800;

drop policy if exists org_docs_storage_select on storage.objects;
create policy org_docs_storage_select
on storage.objects for select to authenticated
using (
  bucket_id = 'organization-documents'
  and exists (
    select 1 from public.organizations o
    where o.id::text = (storage.foldername(name))[1]
      and public.has_org_permission(o.id,'documents.view')
  )
);

drop policy if exists org_docs_storage_insert on storage.objects;
create policy org_docs_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'organization-documents'
  and exists (
    select 1 from public.organizations o
    where o.id::text = (storage.foldername(name))[1]
      and public.has_org_permission(o.id,'documents.upload')
  )
);

drop policy if exists org_docs_storage_delete on storage.objects;
create policy org_docs_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'organization-documents'
  and exists (
    select 1 from public.organizations o
    where o.id::text = (storage.foldername(name))[1]
      and public.has_org_permission(o.id,'documents.delete')
  )
);
