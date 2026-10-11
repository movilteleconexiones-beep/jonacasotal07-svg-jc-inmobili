-- Isolated, non-public inventory media for tenant-scoped admin/agent workflows.
begin;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('jco-inventory-private','jco-inventory-private',false,5242880,
  array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=5242880,
 allowed_mime_types=array['image/jpeg','image/png','image/webp'];

create table if not exists public.property_private_photos (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 storage_path text not null unique,
 image_order integer not null check(image_order between 0 and 9),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 byte_size integer not null check(byte_size between 1 and 5242880),
 created_at timestamptz not null default now(),
 unique(property_id,image_order)
);
create index if not exists property_private_photos_property_idx
on public.property_private_photos(organization_id,property_id);
alter table public.property_private_photos enable row level security;
revoke all on public.property_private_photos from public,anon,authenticated;
grant select,insert,delete on public.property_private_photos to authenticated;
grant all on public.property_private_photos to service_role;

drop policy if exists jco_inventory_photos_read on public.property_private_photos;
create policy jco_inventory_photos_read on public.property_private_photos for select
to authenticated using (public.has_org_permission(organization_id,'properties.view')
 and exists(select 1 from public.properties p where p.id=property_id and p.organization_id=organization_id));

drop policy if exists jco_inventory_photos_insert on public.property_private_photos;
create policy jco_inventory_photos_insert on public.property_private_photos for insert
to authenticated with check (
 public.has_org_permission(organization_id,'properties.edit')
 and split_part(storage_path,'/',1)=organization_id::text
 and split_part(storage_path,'/',2)=property_id::text
 and exists(select 1 from public.properties p where p.id=property_id and p.organization_id=organization_id)
);

drop policy if exists jco_inventory_photos_delete on public.property_private_photos;
create policy jco_inventory_photos_delete on public.property_private_photos for delete
to authenticated using (public.has_org_permission(organization_id,'properties.edit'));

drop policy if exists jco_inventory_private_storage_read on storage.objects;
create policy jco_inventory_private_storage_read on storage.objects for select
to authenticated using (
 bucket_id='jco-inventory-private'
 and exists(select 1 from public.properties p
   where p.organization_id::text=split_part(name,'/',1)
     and p.id::text=split_part(name,'/',2)
     and public.has_org_permission(p.organization_id,'properties.view'))
);

drop policy if exists jco_inventory_private_storage_insert on storage.objects;
create policy jco_inventory_private_storage_insert on storage.objects for insert
to authenticated with check (
 bucket_id='jco-inventory-private'
 and exists(select 1 from public.properties p
   where p.organization_id::text=split_part(name,'/',1)
     and p.id::text=split_part(name,'/',2)
     and public.has_org_permission(p.organization_id,'properties.edit'))
);

drop policy if exists jco_inventory_private_storage_delete on storage.objects;
create policy jco_inventory_private_storage_delete on storage.objects for delete
to authenticated using (
 bucket_id='jco-inventory-private'
 and exists(select 1 from public.properties p
   where p.organization_id::text=split_part(name,'/',1)
     and p.id::text=split_part(name,'/',2)
     and public.has_org_permission(p.organization_id,'properties.edit'))
);
commit;
