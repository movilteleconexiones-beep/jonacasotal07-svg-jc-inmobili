-- Data onboarding and bulk import support.
-- Allows both new real-estate companies with no legacy data and established companies
-- that want to migrate contacts/properties after purchasing or subscribing.

alter table public.contacts
  add column if not exists import_job_id uuid,
  add column if not exists external_reference text;

alter table public.properties
  add column if not exists import_job_id uuid,
  add column if not exists external_reference text;

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null
    check (entity_type in ('CONTACTS','PROPERTIES')),
  original_filename text not null,
  file_type text not null
    check (file_type in ('CSV','XLSX','XLS')),
  status text not null default 'UPLOADED'
    check (status in ('UPLOADED','MAPPING','VALIDATING','READY','IMPORTING','COMPLETED','COMPLETED_WITH_ERRORS','FAILED','CANCELLED')),
  column_mapping jsonb not null default '{}'::jsonb,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  imported_rows integer not null default 0,
  skipped_rows integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.import_job_rows (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references public.import_jobs(id) on delete cascade,
  row_number integer not null,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING','VALID','INVALID','IMPORTED','SKIPPED','FAILED')),
  target_record_id uuid,
  created_at timestamptz not null default now(),
  unique (import_job_id, row_number)
);

create index if not exists idx_import_jobs_org_created
  on public.import_jobs(organization_id, created_at desc);

create index if not exists idx_import_rows_job_status
  on public.import_job_rows(import_job_id, status);

alter table public.import_jobs enable row level security;
alter table public.import_job_rows enable row level security;

drop policy if exists import_jobs_select on public.import_jobs;
create policy import_jobs_select
on public.import_jobs for select
to authenticated
using (
  public.is_org_member(organization_id)
  and (
    public.has_org_permission(organization_id, 'clients.create')
    or public.has_org_permission(organization_id, 'properties.create')
    or public.has_org_permission(organization_id, 'settings.edit')
  )
);

drop policy if exists import_jobs_insert on public.import_jobs;
create policy import_jobs_insert
on public.import_jobs for insert
to authenticated
with check (
  public.is_org_member(organization_id)
  and (
    (entity_type = 'CONTACTS' and public.has_org_permission(organization_id, 'clients.create'))
    or
    (entity_type = 'PROPERTIES' and public.has_org_permission(organization_id, 'properties.create'))
  )
);

drop policy if exists import_jobs_update on public.import_jobs;
create policy import_jobs_update
on public.import_jobs for update
to authenticated
using (
  public.is_org_member(organization_id)
  and (
    (entity_type = 'CONTACTS' and public.has_org_permission(organization_id, 'clients.create'))
    or
    (entity_type = 'PROPERTIES' and public.has_org_permission(organization_id, 'properties.create'))
  )
)
with check (
  public.is_org_member(organization_id)
);

drop policy if exists import_rows_select on public.import_job_rows;
create policy import_rows_select
on public.import_job_rows for select
to authenticated
using (
  exists (
    select 1
    from public.import_jobs j
    where j.id = import_job_id
      and public.is_org_member(j.organization_id)
  )
);

drop policy if exists import_rows_manage on public.import_job_rows;
create policy import_rows_manage
on public.import_job_rows for all
to authenticated
using (
  exists (
    select 1
    from public.import_jobs j
    where j.id = import_job_id
      and (
        (j.entity_type = 'CONTACTS' and public.has_org_permission(j.organization_id, 'clients.create'))
        or
        (j.entity_type = 'PROPERTIES' and public.has_org_permission(j.organization_id, 'properties.create'))
      )
  )
)
with check (
  exists (
    select 1
    from public.import_jobs j
    where j.id = import_job_id
      and public.is_org_member(j.organization_id)
  )
);

-- Link imported target records to the originating job after table creation.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contacts_import_job_id_fkey'
  ) then
    alter table public.contacts
      add constraint contacts_import_job_id_fkey
      foreign key (import_job_id) references public.import_jobs(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'properties_import_job_id_fkey'
  ) then
    alter table public.properties
      add constraint properties_import_job_id_fkey
      foreign key (import_job_id) references public.import_jobs(id) on delete set null;
  end if;
end $$;
